import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readAdminResponse } from '../apps/admin/lib/api-response.ts';

describe('admin API response handling',()=>{
  it('shows a useful service error when a proxy returns plain Internal Server Error text',async()=>{
    await assert.rejects(readAdminResponse(new Response('Internal Server Error',{status:500})),/HTTP 500.*API dan PostgreSQL berjalan/);
  });
  it('preserves safe JSON API errors and returns valid data',async()=>{
    await assert.rejects(readAdminResponse(Response.json({error:{message:'Nama kategori sudah digunakan.'}},{status:409})),/Nama kategori sudah digunakan/);
    assert.deepEqual(await readAdminResponse(Response.json({data:[{name:'Kostum'}]})),[{name:'Kostum'}]);
  });
});
