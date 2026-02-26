import express from "express";
import bodyParser from "body-parser";
import cors from "cors";
import http from "http"; 
import { Server } from "socket.io"; 
import { workflowQueue } from "../queue/workflowQueue.js";
import { redisConnection } from "../config/redis.js"; 
import { NODE_REGISTRY } from "../engine/nodes/index.js";

const app: express.Application = express();

app.use(cors({ origin: "*" }));
app.use(bodyParser.json());

const PORT: number = 3001;

// --- 1. SETUP HTTP & SOCKET SERVER ---
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*", // Allow Frontend to connect
        methods: ["GET", "POST", "PUT", "DELETE"]
    }
});

// --- 2. SETUP REDIS SUBSCRIBER ---
// We need a dedicated connection for subscribing (cannot reuse the queue connection directly for sub)
const redisSubscriber = redisConnection.duplicate();

redisSubscriber.on('error', (err) => console.error('❌ Redis Subscriber Error:', err));
redisSubscriber.on('connect', () => console.log('✅ Redis Subscriber Connected'));

// Subscribe to the channel where Workers publish events
redisSubscriber.subscribe('workflow_events');

// --- 3. SOCKET LOGIC ---
io.on('connection', (socket) => {
    console.log(`🔌 Client Connected: ${socket.id}`);

    // Client joins a "room" for a specific Job ID
    socket.on('subscribe_job', (jobId) => {
        if (jobId) {
            socket.join(jobId);
            console.log(`   👀 Client ${socket.id} watching Job: ${jobId}`);
        }
    });

    socket.on('disconnect', () => {
        console.log(`🔌 Client Disconnected: ${socket.id}`);
    });
});

// --- 4. BRIDGE: REDIS -> SOCKET ---
// When a Worker publishes an event, we forward it to the specific Frontend client
redisSubscriber.on('message', (channel, message) => {
    if (channel === 'workflow_events') {
        try {
            const event = JSON.parse(message);
            // Broadcast ONLY to clients watching this Job ID
            io.to(event.jobId).emit('workflow_update', event);
        } catch (err) {
            console.error("❌ Failed to parse Redis message:", err);
        }
    }
});

// --- API ROUTE: PRODUCER (DEPLOY & TEST) ---
app.post("/trigger-workflow", async (req, res) => {
    // 🟢 EXTRACT isTestRun FLAG
    const { 
        config: workflowConfig, 
        context: manualContext = {}, 
        isTestRun,
        previousWorkflowId
    } = req.body; 

    if (!workflowConfig) {
        return res.status(400).send({ error: "Missing workflow configuration." });
    }

    try {
        console.log(`\n📥 Received Job: [${workflowConfig.trigger?.type?.toUpperCase() || 'UNKNOWN'}]`);

        // Create a persistent ID based on workflow name or timestamp
        const safeName = (workflowConfig.workflowName || "default").replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        
        const triggerType = workflowConfig.trigger?.type;
        const isTimer = triggerType === 'timer';
        const isWebhook = triggerType === 'webhook';
        
        let workflowId = `job_${Date.now()}`;
        if (isTimer) {
            workflowId = `cron_workflow_${safeName}`;
        } else if (isWebhook) {
            workflowId = `workflow_${safeName}`;
        }

        // 🟢 HANDLE WEBHOOK RENAME / INVALIDATION
        if (isWebhook) {
            const previousId = typeof previousWorkflowId === 'string' ? previousWorkflowId : null;
            if (previousId && previousId !== workflowId) {
                try {
                    const tombstoneKey = `workflow_tombstone:${previousId}`;
                    await redisConnection.set(
                        tombstoneKey,
                        JSON.stringify({
                            status: 'renamed',
                            newWorkflowId: workflowId,
                            renamedAt: new Date().toISOString(),
                        }),
                    );

                    // Optionally remove the old config to avoid stale executions
                    await redisConnection.del(`workflow_config:${previousId}`);

                    console.log(`⚰️  Tombstoned old webhook workflowId=${previousId} -> renamed to ${workflowId}`);
                } catch (err) {
                    console.error('❌ Failed to create webhook tombstone for', previousId, err);
                }
            }
        }

        // 🟢 THE HOT RELOAD FIX: Save the configuration to Redis instead of BullMQ!
        await redisConnection.set(`workflow_config:${workflowId}`, JSON.stringify(workflowConfig));

        // When this name is (re)activated as webhook, clear any old tombstone so 410 only if truly inactive
        if (isWebhook) {
            await redisConnection.del(`workflow_tombstone:${workflowId}`);
        }

        // --- 🚀 HANDLE "RUN NOW" MANUAL OVERRIDE ---
        if (isTestRun) {
            const immediateId = `test_run_${Date.now()}`;
            
            // Inject a mock payload so Webhook variables don't crash the test
            const testContext = {
                ...manualContext,
                WebhookBody: { 
                    test: true, 
                    amount: 100, 
                    email: "test@example.com", 
                    message: "Manual Test Run",
                    // Add dummy data for other common webhook structures just in case
                    data: { id: "test_123", status: "succeeded" }
                }
            };

            await workflowQueue.add(
                'execute-workflow', 
                { 
                    context: testContext, 
                    requestedAt: new Date().toISOString(),
                    workflowId: workflowId, // Must pass the base ID so worker fetches correct config
                    executionId: immediateId // Explicit room ID for Socket broadcasting
                }, 
                { jobId: immediateId } // Unique Job ID for this execution
            );
            
            console.log(`🚀 Manual Test Run Queued: ${immediateId}`);
            return res.status(202).send({ 
                success: true, 
                message: "Test run started!", 
                jobId: immediateId 
            });
        }

        // --- 1. HANDLE WEBHOOK DEPLOYMENTS ---
        if (isWebhook) {
            const webhookUrl = `http://localhost:${PORT}/webhook/${workflowId}`;
            console.log(`🔗 Webhook Deployed! Listening at: ${webhookUrl}`);
            
            return res.status(202).send({ 
                success: true, 
                message: "Webhook Active!", 
                webhookUrl: webhookUrl, 
                jobId: workflowId 
            });
        }

        // --- 2. HANDLE SCHEDULED JOBS (TIMER) ---
        if (isTimer) {
            const { scheduleType, intervalMinutes, cronExpression } = workflowConfig.trigger;
            let repeatOpts: any = {};

            if (scheduleType === 'cron' && cronExpression) {
                // E.g., '0 12 * * *' (Run every day at noon)
                repeatOpts = { pattern: cronExpression };
            } else if (scheduleType === 'interval' && intervalMinutes) {
                // BullMQ expects milliseconds
                const ms = parseInt(intervalMinutes) * 60 * 1000;
                repeatOpts = { every: ms };
            } else {
                return res.status(400).send({ error: "Invalid timer configuration." });
            }

            // --- ♻️ OVERWRITE EXISTING SCHEDULE ---
            // Fetch all active schedules from Redis
            const repeatableJobs = await workflowQueue.getRepeatableJobs();
            
            // Look for an existing schedule matching this workflow's ID
            const existingJob = repeatableJobs.find(job => job.id === workflowId);
            
            if (existingJob) {
                // Remove the old schedule tick
                await workflowQueue.removeRepeatableByKey(existingJob.key);
                console.log(`♻️  Updated existing schedule for: ${workflowConfig.workflowName || 'default'}. Changes applied!`);
            } else {
                console.log(`⏰ Scheduling new workflow: ${workflowId} with opts:`, repeatOpts);
            }

            await workflowQueue.add(
                'execute-workflow', 
                {
                    // Notice we NO LONGER send config here! Just the ID and context.
                    context: manualContext,
                    requestedAt: new Date().toISOString(),
                    workflowId: workflowId 
                }, 
                { 
                    repeat: repeatOpts,
                    jobId: workflowId // Keeps the job ID consistent across repeats
                }
            );

            return res.status(202).send({ 
                success: true, 
                message: "Workflow scheduled successfully!",
                jobId: workflowId 
            });
        }

        // --- 3. STANDARD IMMEDIATE JOBS (Manual Deploy, etc.) ---
        const job = await workflowQueue.add(
            'execute-workflow', 
            {
                // Notice we NO LONGER send config here! Just the ID and context.
                context: manualContext,
                requestedAt: new Date().toISOString(),
                workflowId: workflowId 
            },
            {
                jobId: workflowId // Force the base Job ID to match
            }
        );

        console.log(`   ✅ Queued Immediate Job ID: ${job.id}`);
        
        res.status(202).send({ 
            success: true, 
            message: "Workflow queued successfully", 
            jobId: job.id // Frontend needs this ID to subscribe!
        });

    } catch (error: any) {
        console.error("❌ API Error:", error);
        res.status(500).send({ error: "Failed to queue workflow" });
    }
});

// --- THE WEBHOOK RECEIVER ---
app.post('/webhook/:workflowId', async (req, res) => {
    const { workflowId } = req.params;

    try {
        // 0. Basic validation on webhookId format
        if (typeof workflowId !== 'string' || !workflowId.startsWith('workflow_')) {
            console.warn(`⚠️ Malformed webhook name received: ${workflowId}`);
            return res.status(400).json({ error: "Malformed webhook name." });
        }

        // 1. Validate against current active workflow first (name can become active again after rename-back)
        const configString = await redisConnection.get(`workflow_config:${workflowId}`);
        if (configString) {
            // Active config exists → webhook is valid (even if an old tombstone exists from a previous rename)
            // Fall through to queue logic below
        } else {
            // 2. No active config: return 410 only if this name was previously active (tombstone)
            const tombstoneKey = `workflow_tombstone:${workflowId}`;
            const tombstoneRaw = await redisConnection.get(tombstoneKey);
            if (tombstoneRaw) {
                try {
                    const tombstone = JSON.parse(tombstoneRaw);
                    console.warn(
                        `🚫 Webhook called for inactive workflowId=${workflowId} (status=${tombstone.status || 'unknown'})`,
                    );
                } catch {
                    console.warn(`🚫 Webhook called for inactive workflowId=${workflowId} (malformed tombstone)`);
                }
                return res.status(410).json({
                    error: "This webhook has been renamed or deleted.",
                });
            }
            // 3. Never deployed under this name
            console.warn(`❓ Webhook not found for workflowId=${workflowId}`);
            return res.status(404).json({ error: "Webhook not found. Has this workflow been deployed?" });
        }

        // 3. Capture the incoming data from the external app
        // We nest it inside "WebhookBody" so users can access it cleanly
        const externalContext = {
            WebhookBody: req.body,       // The JSON payload (e.g., Stripe payment data)
            WebhookQuery: req.query,     // Any URL parameters
            WebhookHeaders: req.headers  // Useful for signature verification later
        };

        // 4. Queue the job in BullMQ
        const executionId = `webhook_exec_${Date.now()}`;
        
        await workflowQueue.add(
            'execute-workflow', 
            { 
                workflowId: workflowId, 
                executionId: workflowId, // 🟢 FIX: Broadcast visuals to the base workflow room so frontend sees it
                context: externalContext,
                requestedAt: new Date().toISOString()
            }, 
            { jobId: executionId } // Job ID must stay unique so BullMQ doesn't deduplicate it
        );

        console.log(`📥 Webhook received for [${workflowId}]. Queued execution: ${executionId}`);
        
        // Return a 200 OK immediately so the external service doesn't timeout waiting for the blockchain
        res.status(200).json({ success: true, message: "Webhook accepted and queued." });

    } catch (error: any) {
        console.error("Webhook processing error:", error);
        res.status(500).json({ error: "Internal Server Error" });
    }
});

// --- API ROUTE: SAVE WORKFLOW EDITOR STATE ---
app.post('/workflow-state', async (req, res) => {
    try {
        const {
            name,
            nodes,
            edges,
            globalSettings = {},
            workflowId,
        } = req.body || {};

        if (!name || !Array.isArray(nodes) || !Array.isArray(edges)) {
            return res.status(400).json({
                success: false,
                error: "Missing required fields: name, nodes, edges",
            });
        }

        const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const storageKey = `workflow_state:${safeName}`;

        let version = 1;
        let createdAt = new Date().toISOString();
        const existingRaw = await redisConnection.get(storageKey);
        if (existingRaw) {
            try {
                const existing = JSON.parse(existingRaw);
                version = (existing.version || 1) + 1;
                createdAt = existing.createdAt || createdAt;
            } catch {
                // Ignore parse errors and treat as new
            }
        }

        const now = new Date().toISOString();
        const payload = {
            id: workflowId || `workflow_${safeName}`,
            name,
            nodes,
            edges,
            globalSettings,
            version,
            createdAt,
            updatedAt: now,
        };

        await redisConnection.set(storageKey, JSON.stringify(payload));

        return res.json({ success: true, workflow: payload });
    } catch (error: any) {
        console.error("❌ Save Workflow State Error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal Server Error",
        });
    }
});

// --- API ROUTE: LOAD WORKFLOW EDITOR STATE ---
app.get('/workflow-state/:name', async (req, res) => {
    try {
        const { name } = req.params;
        if (!name) {
            return res.status(400).json({
                success: false,
                error: "Missing workflow name",
            });
        }

        const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const storageKey = `workflow_state:${safeName}`;
        const existingRaw = await redisConnection.get(storageKey);

        if (!existingRaw) {
            return res.status(404).json({
                success: false,
                error: "Saved workflow not found",
            });
        }

        let workflow;
        try {
            workflow = JSON.parse(existingRaw);
        } catch (err: any) {
            console.error("❌ Failed to parse saved workflow state:", err);
            return res.status(500).json({
                success: false,
                error: "Corrupted workflow state",
            });
        }

        return res.json({ success: true, workflow });
    } catch (error: any) {
        console.error("❌ Load Workflow State Error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal Server Error",
        });
    }
});

// --- API ROUTE: DELETE A SAVED WORKFLOW ---
app.delete('/workflow-state/:name', async (req, res) => {
    try {
        const { name } = req.params;
        if (!name) {
            return res.status(400).json({
                success: false,
                error: "Missing workflow name",
            });
        }

        const safeName = String(name).replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
        const storageKey = `workflow_state:${safeName}`;
        const deletedCount = await redisConnection.del(storageKey);

        return res.json({
            success: true,
            deleted: deletedCount > 0,
        });
    } catch (error: any) {
        console.error("❌ Delete Workflow State Error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal Server Error",
        });
    }
});

// --- API ROUTE: LIST ALL SAVED WORKFLOWS (GALLERY) ---
app.get('/workflow-states', async (_req, res) => {
    try {
        const keys = await redisConnection.keys('workflow_state:*');

        if (!keys || keys.length === 0) {
            return res.json({ success: true, workflows: [] });
        }

        const rawValues = await redisConnection.mget(keys);
        const workflows: Array<{ id: string; name: string; createdAt?: string }> = [];

        rawValues.forEach((raw) => {
            if (!raw) return;
            try {
                const parsed = JSON.parse(raw);
                if (!parsed || !parsed.name) return;

                workflows.push({
                    id: parsed.id || '',
                    name: parsed.name,
                    createdAt: parsed.createdAt || parsed.updatedAt,
                });
            } catch {
                // Ignore malformed entries
            }
        });

        // Optional: sort by createdAt desc when available
        workflows.sort((a, b) => {
            const aTime = a.createdAt ? Date.parse(a.createdAt) : 0;
            const bTime = b.createdAt ? Date.parse(b.createdAt) : 0;
            return bTime - aTime;
        });

        return res.json({ success: true, workflows });
    } catch (error: any) {
        console.error("❌ List Workflows Error:", error);
        return res.status(500).json({
            success: false,
            error: error.message || "Internal Server Error",
        });
    }
});

// --- API ROUTE: HOT RELOAD ---
app.put('/hot-reload', async (req, res) => {
    const { workflowId, config } = req.body;
    try {
        if (!workflowId || !config) {
            return res.status(400).json({ success: false, error: "Missing workflowId or config" });
        }
        
        // Silently overwrite the active configuration in Redis
        await redisConnection.set(`workflow_config:${workflowId}`, JSON.stringify(config));
        
        res.json({ success: true });
    } catch (error: any) {
        console.error("❌ Hot Reload Error:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- API ROUTE: TEST INDIVIDUAL NODE ---
app.post('/test-node', async (req, res) => {
    try {
        const { type, config } = req.body;
        
        const nodeExecutor = NODE_REGISTRY[type];
        if (!nodeExecutor) {
            return res.status(400).json({ success: false, error: `Unknown node type: ${type}` });
        }

        const mockContext = { 
            TEST_MODE: true,
        };

        const result = await nodeExecutor(config, mockContext);
        
        res.json({ success: true, data: result });
    } catch (error: any) {
        console.error(`Test Node Error (${req.body.type}):`, error.message);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- API ROUTE: RESUME PAUSED WORKFLOW ---
app.post('/resume-workflow', async (req, res) => {
    const { workflowId, jobId } = req.body;

    if (!workflowId || !jobId) {
        return res.status(400).json({ success: false, error: "Missing workflowId or jobId" });
    }

    try {
        const pauseKey = `workflow_pause:${workflowId}:${jobId}`;
        const raw = await redisConnection.get(pauseKey);

        if (!raw) {
            return res.status(404).json({ success: false, error: "No paused workflow state found." });
        }

        const pauseState = JSON.parse(raw);
        if (!pauseState.remainingActions || !pauseState.context) {
            return res.status(500).json({ success: false, error: "Paused state is corrupted." });
        }

        // Prevent multiple resumes from the same paused state
        await redisConnection.del(pauseKey);

        const executionId = `resume_${Date.now()}`;

        await workflowQueue.add(
            'execute-workflow',
            {
                context: pauseState.context,
                requestedAt: new Date().toISOString(),
                workflowId: workflowId,
                executionId,
                resume: true,
                remainingActions: pauseState.remainingActions,
                spreadsheetIdOverride: pauseState.spreadsheetId || null,
            },
            { jobId: executionId }
        );

        return res.status(202).json({ success: true, jobId: executionId });
    } catch (error: any) {
        console.error("❌ Resume Workflow Error:", error);
        return res.status(500).json({ success: false, error: "Failed to resume workflow." });
    }
});

// --- GET ACTIVE SCHEDULES ---
app.get('/schedules', async (req, res) => {
    try {
        // BullMQ built-in method to get all repeatable jobs
        const jobs = await workflowQueue.getRepeatableJobs();
        
        // Format the output for the frontend
        const formattedJobs = jobs.map(job => ({
            key: job.key,
            name: job.name,
            id: job.id, // This is the workflowId we passed earlier
            pattern: job.pattern || `Every ${job.every / 60000} mins`,
            nextRun: new Date(job.next).toLocaleString(),
            nextRunTimestamp: job.next // <-- Added this line to pass the raw timestamp to the frontend
        }));

        res.json({ success: true, jobs: formattedJobs });
    } catch (error: any) {
        console.error("Error fetching schedules:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- DELETE/STOP A SCHEDULE ---
app.delete('/schedules/:key', async (req, res) => {
    try {
        const { key } = req.params;
        
        // BullMQ requires the exact 'key' (a combination of id, cron string, etc.) to remove it
        // We decode it because it's passed as a URL parameter
        const decodedKey = decodeURIComponent(key);
        
        await workflowQueue.removeRepeatableByKey(decodedKey);
        
        console.log(`🛑 Stopped schedule: ${decodedKey}`);
        res.json({ success: true, message: "Schedule stopped successfully." });
    } catch (error: any) {
        console.error("Error stopping schedule:", error);
        res.status(500).json({ success: false, error: error.message });
    }
});

// --- START SERVER ---
// Note: We listen on 'server' (HTTP+Socket), not just 'app' (Express)
server.listen(PORT, () => {
    console.log(`🚀 Nexus Producer API + Socket Server running on http://localhost:${PORT}`);
});