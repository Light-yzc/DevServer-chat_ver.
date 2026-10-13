#!/usr/bin/env node
/** Safe Local Luna/Local Sol read/create entrypoint for project Overview.
 * This CLI intentionally does not provide manager edit/archive/delete flags;
 * those require an authenticated Web Main or private Tips view credential. */
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
import {loadConfig} from '../vendor/devspace/dist/config.js';
import {createTipsV2} from '../vendor/devspace/dist/tips-core.js';
import {createTipsProjectBoard} from '../vendor/devspace/dist/tips-project.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
process.env.DEVSPACE_CONFIG_DIR??=ROOT+'/var/config';
const board=createTipsProjectBoard(createTipsV2(loadConfig()));
const action=process.argv[2]??'overview';
if(!['overview','list','get','history','create'].includes(action))
  throw Error('CLI supports only overview/list/get/history/create; project management needs an authorized Main');
const input={action};
if(['get','history'].includes(action))input.id=process.argv[3];
if(action==='list'&&process.argv[3])input.limit=Number(process.argv[3]);
if(action==='create'){
  let raw='';for await(const chunk of process.stdin){raw+=chunk;if(raw.length>16000)throw Error('Task data too large')}
  Object.assign(input,JSON.parse(raw));input.action='create';
}
console.log(JSON.stringify(board.run(input,{actor:'local-agent-unassigned'}),null,2));
