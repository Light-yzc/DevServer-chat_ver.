import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,dirname} from 'node:path';
import {runInNewContext} from 'node:vm';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const html=readFileSync(resolve(root,'vendor/devspace/dist/tips-dashboard.html'),'utf8');
const js=html.split('<script>')[1]?.split('</script>')[0]??'';
const source=js.slice(js.indexOf(' function agentRole('),js.indexOf(' function activateTab('));

function element(tag,text,cls){
  return {tag,text,cls,children:[],attributes:{},events:{},append(...items){this.children.push(...items)},
    setAttribute(k,v){this.attributes[k]=v},addEventListener(k,fn){this.events[k]=fn}};
}
const api=runInNewContext(`${source}\n;({agentRole,agentParty,messageRoute})`,{
  node:element,add:(parent,...children)=>{parent.append(...children);return parent},
  String,activateTab:()=>{},renderInbox:()=>{},
  $:()=>({value:'',options:[],add(){}}),Option:function(x){this.value=x},
});

test('stable semantic identity colors are assigned, including old web controller',()=>{
  for(const [id,expected] of [
    ['server-controller','main'],['chatgpt-research-controller','research'],
    ['web-main','web-main'],['web-reviewer-01','web'],
    ['sub-air-mbpp','sub'],['tips-block-watch','monitor'],['unknown-worker','other'],
  ])assert.equal(api.agentRole(id).kind,expected,id);
});

test('message routing renders explicit from/to roles, not color alone',()=>{
  const view=api.messageRoute('chatgpt-research-controller','server-controller');
  assert.equal(view.cls,'mail-route');
  assert.equal(view.children.length,3);
  assert.equal(view.children[0].children[0].text,'发');
  assert.equal(view.children[0].children[1].cls,'route-party role--research');
  assert.equal(view.children[0].children[1].children[1].text,'chatgpt-research-controller');
  assert.equal(view.children[1].text,'→');
  assert.equal(view.children[2].children[0].text,'收');
  assert.equal(view.children[2].children[1].cls,'route-party role--main');
  assert.match(view.children[2].children[1].attributes['aria-label'],/接收方/);
});

test('identity legend, independent ACK/priority states, and mobile layout are present',()=>{
  for(const fragment of ['mail-legend','role--web','role--main','role--sub','role--monitor',
    'mail-status--acknowledged','priority-high','@media(max-width:700px)','messageRoute(m.from,m.to)'])
    assert.ok(html.includes(fragment),fragment);
});
test('passive Sol messages and legacy inbox are clearly distinguished from lost mail',()=>{
  for(const fragment of [
    "mail-filter=\"passive\"","mail-filter=\"mainready\"",
    '未请求唤醒','wakeAuthorized=false','不会单独启动',
    '旧 Web 收件箱','未唤醒，尚无法验收',
  ])assert.ok(html.includes(fragment),fragment);
});
