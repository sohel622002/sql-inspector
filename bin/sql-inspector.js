#!/usr/bin/env node
import { startServer } from '../server/index.js';

const port = Number(process.env.SQL_INSPECTOR_PORT) || 4545;

startServer({ port }).then(({ port: boundPort }) => {
  console.log(`sql-inspector running at http://localhost:${boundPort}`);
  console.log(`App clients connect over ws://localhost:${boundPort}/relay`);
});
