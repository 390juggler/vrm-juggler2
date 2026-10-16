import {beforeAll,afterAll,it,expect} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import VRMJuggler from '../src/index';
import '../dist/sync-compose-ui.js';

let app:VRMJuggler;
const reports:any[]=[];
beforeAll(async()=>{
 const f=readFileSync('dist/models/default.vrm');
 app=await VRMJuggler.createSyncPlanner(f.buffer.slice(f.byteOffset,f.byteOffset+f.byteLength));
},20000);
afterAll(()=>{(app as any)?.juggling.dispose();if(process.env.SYNC_VERTICAL_AUDIT)writeFileSync(process.env.SYNC_VERTICAL_AUDIT,JSON.stringify(reports,null,2));});

it.each([false,true].flatMap(mirror=>[false,true].map(swap=>({mirror,swap}))))
('generates Cross Inverted / Cross side column Up (mirror=$mirror, swap=$swap)',({mirror,swap})=>{
 const s=(globalThis as any).SyncComposeUI.namedParts(VRMJuggler,{columns:swap?'crossed-right':'crossed',left:swap?'cross-side-vertical-up':'inverted',right:swap?'inverted':'cross-side-vertical-up',roles:'alternate',shortHand:1});
 s.allowBallContact=true;const source=JSON.stringify(s),start=Date.now(),result=app.setSyncSequence(s,mirror);
 expect(result.ok,JSON.stringify(result)).toBe(true);expect(JSON.stringify(s)).toBe(source);
 const program=app.getSyncProgram()!,geometry=app.getSyncBoxReport()!,skeleton=app.inspectSyncCycle()!;
 const vertical=program.flights.filter(f=>f.style==='vertical-up');expect(vertical.length).toBeGreaterThan(0);
 for(const f of vertical){
  expect(f.catch.position[0]).toBeCloseTo(f.release.position[0],8);
  expect(f.catch.position[2]).toBeCloseTo(f.release.position[2],8);
  expect(f.catch.position[1]).toBeGreaterThan(f.release.position[1]);
 }
 expect(geometry.geometryOK).toBe(true);expect(geometry.ballOrderOK).toBe(true);expect(geometry.ballOrderChecks).toBeGreaterThan(0);
 expect(skeleton.skeletonOK,JSON.stringify(skeleton)).toBe(true);
 const plan=app.exportSyncPlan();
 expect(app.applySyncPlan(s,mirror,structuredClone(plan)).ok).toBe(true);
 expect(app.getSyncProgram()).toEqual(program);
 reports.push({mirror,swap,milliseconds:Date.now()-start,geometry,skeleton,program});
},120000);
