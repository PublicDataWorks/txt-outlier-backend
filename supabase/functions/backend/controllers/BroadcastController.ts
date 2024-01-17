import BroadcastService from '../services/BroadcastService.ts';
import {Request, Response} from 'express';

async function make(req: Request, res: Response) {
    try {
        const broadcast = await BroadcastService.create();
        return res.status(200).json({ broadcast });
    } catch (error) {
        console.error("Error in making broadcast:", error.message);
        return res.status(500).json({ error: "Internal Server Error" });
    }
}

export default {
    make,
} as const;
