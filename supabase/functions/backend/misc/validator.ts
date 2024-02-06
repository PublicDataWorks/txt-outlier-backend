import { ValidationChain, validationResult } from 'express-validator'
import { Request } from 'express'

export const validateAndResponse = async (
  validations: ValidationChain[],
  req: Request,
  res: Response,
): Promise<void> => {
  await Promise.all(validations.map((validation) => validation.run(req)))
  const errors = validationResult(req)
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() })
  }
}
