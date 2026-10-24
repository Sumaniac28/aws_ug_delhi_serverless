#!/usr/bin/env node
import { App } from 'aws-cdk-lib';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from '../lib/config.ts';
import { loadScriptHashes } from '../lib/csp.ts';
import { createStacks } from '../lib/stacks.ts';

const ADMIN_DIST = fileURLToPath(new URL('../../admin/dist', import.meta.url));
if (!existsSync(ADMIN_DIST)) {
  throw new Error(`${ADMIN_DIST} not found. Build the admin app first: cd admin && npm run build`);
}

const app = new App();
createStacks(app, loadConfig(app), { scriptHashes: loadScriptHashes(), adminAssets: s3deploy.Source.asset(ADMIN_DIST) });
