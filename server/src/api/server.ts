import express from "express";
import http from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import redis from "../config/redis.js";
import { workflowQueue } from "../queue/workflowQueue.js";

dotenv.config();

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

/**
 * Health Check
 */
app.get("/", (_, res) => {
  res.json({ status: "Nexus Flow Backend Running 🚀" });
});

/**
 * Trigger Workflow
 */
app.post("/trigger-workflow", async (req, res) => {
  try {
    const { workflowId, context } = req.body;

    if (!workflowId) {
      return res.status(400).json({ error: "workflowId required" });
    }

    const job = await workflowQueue.add("execute-workflow", {
      workflowId,
      context: context || {}
    });

    res.json({
      success: true,
      jobId: job.id
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to queue workflow" });
  }
});

/**
 * Webhook Trigger
 */
app.post("/webhook/:workflowId", async (req, res) => {
  const { workflowId } = req.params;

  await workflowQueue.add("execute-workflow", {
    workflowId,
    context: req.body
  });

  res.json({ success: true });
});

/**
 * WebSocket Connection
 */
io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
  });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});