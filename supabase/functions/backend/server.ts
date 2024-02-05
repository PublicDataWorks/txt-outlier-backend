import morgan from 'morgan'
import helmet from 'helmet'
import cors from 'cors'

import express, { NextFunction, Request, Response } from 'express'

import 'express-async-errors'

import BaseRouter from './routes/Api.ts'
import Paths from './constants/Paths.ts'
import RouteError from './exception/RouteError.ts'
import SystemError from './exception/SystemError.ts'

const app = express()

app.use(express.json())
app.use(express.urlencoded({ extended: true }))
app.use(morgan('dev'))
app.use(cors())

// Security
app.use(helmet())

app.use(Paths.Base, BaseRouter)

app.use((
	err: Error,
	_: Request,
	res: Response,
	_next: NextFunction,
) => {
	let status = 500
	if (err instanceof SystemError) {
		// TODO: send slack
	}
	if (err instanceof RouteError) status = err.status
	return res.status(status).json({ errors: JSON.parse(err.message) })
})
export default app
