import jsonfile from 'jsonfile';

import { IUser } from '../models/User.ts';
import * as path from "https://deno.land/std@0.212.0/path/mod.ts";

// **** Variables **** //

const DB_FILE_NAME = 'database.json';
const __dirname = path.dirname(path.fromFileUrl(import.meta.url));


// **** Types **** //

interface IDb {
  users: IUser[];
}


// **** Functions **** //

/**
 * Fetch the json from the file.
 */
function openDb(): Promise<IDb> {
  return jsonfile.readFile(__dirname + '/' + DB_FILE_NAME) as Promise<IDb>;
}

/**
 * Update the file.
 */
function saveDb(db: IDb): Promise<void> {
  return jsonfile.writeFile((__dirname + '/' + DB_FILE_NAME), db);
}


// **** Export default **** //

export default {
  openDb,
  saveDb,
} as const;
