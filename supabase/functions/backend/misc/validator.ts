import { ValidationChain, validationResult } from 'express-validator'
import { Request } from 'express'
import RouteError from '../exception/RouteError.ts'

export const validateAndResponse = async (validations: ValidationChain[], req: Request) => {
  await Promise.all(validations.map((validation) => validation.run(req)))
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    throw new RouteError(400, JSON.stringify(errors.array()))
  }
}
