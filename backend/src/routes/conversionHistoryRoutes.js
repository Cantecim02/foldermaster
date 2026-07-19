import express from "express";
import { z } from "zod";
import {
  addConversionHistory,
  authenticateRequest,
  listConversionHistory
} from "../services/accountService.js";

export const conversionHistoryRoutes = express.Router();

const formatSchema = z.string().trim().min(2).max(16).regex(/^[a-z0-9]+$/i).transform((value) => value.toUpperCase());
const createHistorySchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  from: formatSchema,
  to: formatSchema,
  fileSizeBytes: z.number().int().nonnegative().max(10_000_000_000),
  status: z.enum(["completed", "failed"])
}).strict();
const listHistorySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(30)
}).strict();

conversionHistoryRoutes.get("/", (request, response, next) => {
  try {
    const account = authenticateRequest(request);
    const { limit } = listHistorySchema.parse(request.query);
    response.json({
      success: true,
      items: listConversionHistory({ userId: account.user.id, limit })
    });
  } catch (error) {
    next(error);
  }
});

conversionHistoryRoutes.post("/", (request, response, next) => {
  try {
    const account = authenticateRequest(request);
    const payload = createHistorySchema.parse(request.body);
    const item = addConversionHistory({ userId: account.user.id, ...payload, inputFormat: payload.from, outputFormat: payload.to });
    response.status(201).json({ success: true, item });
  } catch (error) {
    next(error);
  }
});
