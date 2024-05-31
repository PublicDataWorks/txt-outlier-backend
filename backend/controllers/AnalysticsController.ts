import { Request, Response } from 'express'
import { AnalyticsService } from '../services/AnalyticsService.ts'

async function sendWeeklyReport(
  _req: Request,
  res: Response,
) {
  const result = await AnalyticsService.sendWeeklyReport()
  return res.status(200).json(result)
}

export default {
  sendWeeklyReport,
} as const
