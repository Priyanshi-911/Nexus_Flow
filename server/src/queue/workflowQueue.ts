import { Queue } from "bullmq";
import redis from "../config/redis.js";

export const workflowQueue = new Queue("workflow-queue", {
  connection: redis
});