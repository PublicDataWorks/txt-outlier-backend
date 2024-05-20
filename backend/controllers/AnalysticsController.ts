import { Request, Response } from 'express'
import AnalyticsService from '../services/AnalyticsService.ts'


async function getUnsubcribeReport(
  _req: Request,
  res: Response,
) {
  const result = AnalyticsService.generateWeeklyAnalyticsReport()
  return res.status(200).json(result)
}

export default {
  getUnsubcribeReport,
} as const
