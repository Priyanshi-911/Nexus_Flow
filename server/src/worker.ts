import { Worker } from "bullmq";
import dotenv from "dotenv";
import redis from "./config/redis.js";

dotenv.config();

console.log("👷 Worker started...");

const worker = new Worker(
  "workflow-queue",
  async (job) => {
    console.log("Processing job:", job.id);
    console.log("Data:", job.data);

    const { workflowId, context } = job.data;

    // Simulated workflow execution
    console.log(`Executing workflow ${workflowId}`);
    console.log("Context:", context);

    // Example: Save memory state
    await redis.set(
      `workflow:last_run:${workflowId}`,
      new Date().toISOString()
    );

    return { success: true };
  },
  {
    connection: redis
  }
);

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed`, err);
});