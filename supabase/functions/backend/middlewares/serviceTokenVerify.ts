/**
 * Middleware to verify user logged in and is an an admin.
 */

import { Request, Response, NextFunction } from 'express';

// **** Variables **** //

const USER_UNAUTHORIZED_ERR = 'User not authorized to perform this action';

// **** Functions **** //

/**
 * See note at beginning of file.
 */
async function serviceTokenVerify(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  let token = "";
  if (req.headers.authorization && req.headers.authorization.split(' ')[0] === 'Bearer') {
    token = req.headers.authorization.split(' ')[1];
  }
  if (token !== Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!){
    return res.status(401).json({ message: "Unauthorized" })
  }
  next()
}


// **** Export Default **** //

export default serviceTokenVerify;
