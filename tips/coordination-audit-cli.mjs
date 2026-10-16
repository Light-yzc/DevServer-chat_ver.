#!/usr/bin/env node
/** Live read-only Web Main handoff audit, no model/manager required. */
import {fileURLToPath} from 'node:url';
import {dirname,resolve,join} from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {coordinationAudit} from './coordination-audit.mjs';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const dirs=[join(root,'devspace-config'),join(root,'../devspace-config'),join(root,'var/config')];
process.env.DEVSPACE_CONFIG_DIR??=dirs.find(dir=>existsSync(join(dir,'config.json')))??dirs.at(-1);
const cfg=loadConfig(),tips=createTipsV2(cfg);
const registryFile=join(tips.dir,'subagents','registry.json');
const agents=existsSync(registryFile)?Object.values(JSON.parse(readFileSync(registryFile,'utf8')).agents??{}):[];
const report=coordinationAudit({tasks:tips.snapshot().tasks,agents});
process.stdout.write(JSON.stringify(report,null,2)+'\n');
