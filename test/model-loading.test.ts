import {it,expect,vi} from 'vitest';
import {GLTFLoader} from 'three/examples/jsm/loaders/GLTFLoader.js';
import VRMJuggler from '../src/index';

it('bounds loading progress when decoded bytes exceed the compressed content length',async()=>{
  const api=new VRMJuggler(),message=vi.spyOn(api as any,'showMessage').mockImplementation(()=>{});
  const log=vi.spyOn(console,'error').mockImplementation(()=>{});
  const load=vi.spyOn(GLTFLoader.prototype,'load').mockImplementation((_url,_loaded,progress,error)=>{
    progress!({loaded:50,total:100} as ProgressEvent);
    progress!({loaded:200,total:100} as ProgressEvent);
    // End the mocked download without creating a renderer or VRM.
    error!(new Error('test download ended'));
  });
  try{
    await api.loadModel('test.vrm');
    expect(message.mock.calls.map(c=>c[0])).toContain('モデルを読み込んでいます… 50%');
    expect(message.mock.calls.map(c=>c[0])).toContain('モデルを読み込んでいます… 100%');
    expect(message.mock.calls.some(c=>String(c[0]).includes('200%'))).toBe(false);
  }finally{load.mockRestore();log.mockRestore();message.mockRestore();}
});
