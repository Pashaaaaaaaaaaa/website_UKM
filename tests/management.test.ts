import 'dotenv/config';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { getPool } from '../packages/database/src/client.ts';
import { createApp } from '../packages/api/src/server.ts';
import { createBooking } from '../packages/api/src/booking-service.ts';

const enabled=Boolean(process.env.DATABASE_URL);
describe('CMS and administrative management API', {skip:!enabled},()=>{
 const pool=getPool();let server:ReturnType<ReturnType<typeof createApp>['listen']>;let base='';let news='';let manager='';let brt='';
 const call=(path:string,method='GET',cookie=news,body?:unknown)=>fetch(`${base}${path}`,{method,headers:{...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 async function login(email:string){const r=await fetch(`${base}/api/admin/auth/login`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password:'ChangeMe-Dev-Only-123!'})});assert.equal(r.status,200);return r.headers.get('set-cookie')!.split(';')[0]!;}
 before(async()=>{server=createApp(pool).listen(0);await new Promise<void>(resolve=>server.once('listening',resolve));const address=server.address();if(!address||typeof address==='string')throw new Error('API test server did not start');base=`http://127.0.0.1:${address.port}`;news=await login('news-admin@development.invalid');manager=await login('manager@development.invalid');brt=await login('brt-admin@development.invalid');});
 after(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await pool.end();});

 it('creates, edits, publishes, unpublishes and deletes news with taxonomy relationships and unique slugs',async()=>{
  const suffix=randomUUID();const make=async(endpoint:string,name:string)=>{const r=await call(`/api/admin/news/${endpoint}`,'POST',news,{name,slug:`${name.toLowerCase()}-${suffix}`});assert.equal(r.status,201);return (await r.json() as {data:{id:string}}).data.id;};
  const category=await make('categories','Category');const tag=await make('tags','Tag');const division=await make('divisions','Division');
  const payload={title:'CMS article',excerpt:'Summary',content:'First draft',category_id:category,tag_ids:[tag],division_ids:[division],status:'DRAFT'};
  let response=await call('/api/admin/news/articles','POST',news,payload);assert.equal(response.status,201);const article=(await response.json() as {data:{id:string;status:string;slug:string}}).data;assert.equal(article.status,'DRAFT');assert.match(article.slug,/^cms-article(?:-\d+)?$/);
  response=await call('/api/admin/news/articles','POST',news,{...payload,slug:article.slug});assert.equal(response.status,409);
  response=await call(`/api/admin/news/articles/${article.id}`,'PUT',news,{...payload,title:'Edited article'});assert.equal(response.status,200);
  response=await call(`/api/admin/news/articles/${article.id}/status`,'PATCH',news,{status:'PUBLISHED'});assert.equal(response.status,200);
  const publicResponse=await call(`/api/public/articles/${article.slug}`);assert.equal(publicResponse.status,200);
  const publicArticle=(await publicResponse.json() as {data:{author:string;tags:Array<{id:string}>;divisions:Array<{id:string}>;comments:unknown[]}}).data;assert.equal(publicArticle.author,'News Admin');assert.equal(publicArticle.tags[0]!.id,tag);assert.equal(publicArticle.divisions[0]!.id,division);assert.deepEqual(publicArticle.comments,[]);
  const publicList=await call(`/api/public/articles?page=1&page_size=2&search=${encodeURIComponent('Edited article')}&category=${category}&tag=${tag}&division=${division}`);assert.equal(publicList.status,200);const publicResults=(await publicList.json() as {data:{items:Array<{slug:string;title:string}>;total:number}}).data;assert.equal(publicResults.total,1);assert.equal(publicResults.items[0]!.slug,article.slug);
  const filtered=await call(`/api/admin/news/articles?tag=${tag}&division=${division}`, 'GET',news);assert.equal(filtered.status,200);assert.ok(((await filtered.json() as {data:unknown[]}).data).length>=1);
  response=await call(`/api/admin/news/articles/${article.id}/status`,'PATCH',news,{status:'UNPUBLISHED'});assert.equal(response.status,200);assert.equal((await call(`/api/public/articles/${article.slug}`)).status,404);
  await call(`/api/admin/news/articles/${article.id}`,'DELETE',news);await call(`/api/admin/news/categories/${category}`,'DELETE',news);await call(`/api/admin/news/tags/${tag}`,'DELETE',news);await call(`/api/admin/news/divisions/${division}`,'DELETE',news);
 });

 it('publishes sanitized visitor comments immediately and applies anti-spam limits',async()=>{
  const suffix=randomUUID(),slug=`comment-${suffix}`;const created=await call('/api/admin/news/articles','POST',news,{title:'Comment target',slug,content:'article',status:'PUBLISHED'});assert.equal(created.status,201);const id=(await created.json() as {data:{id:string}}).data.id;
  const posted=await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',email:'visitor@example.test',content:'<script>alert(1)</script>Useful thought'});assert.equal(posted.status,201,JSON.stringify(await posted.clone().json()));const comment=(await posted.json() as {data:{id:string;status:string}}).data;assert.equal(comment.status,'APPROVED');
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'Another useful thought'})).status,201);
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'One more useful thought'})).status,201);
  assert.equal((await call(`/api/public/articles/${slug}/comments`,'POST','',{name:'Visitor',content:'Rate limited comment'})).status,429);
  const article=await (await call(`/api/public/articles/${slug}`)).json() as {data:{comments:Array<{content:string}>}};assert.equal(article.data.comments.length,3);assert.ok(article.data.comments.some(entry=>entry.content==='alert(1)Useful thought'));assert.ok(article.data.comments.every(entry=>!entry.content.includes('<script>')));
  await call(`/api/admin/news/articles/${id}`,'DELETE',news);
 });

 it('updates organization information and keeps members in requested order',async()=>{
  const org=await call('/api/admin/news/organization','PUT',news,{name:'Test organization',description:'Description',history:'History',address:'Jl. Contoh 1',phone:'+62812345',email:'info@example.test'});assert.equal(org.status,200);
  const field=await call('/api/admin/news/organization/units','POST',news,{name:`Bidang ${randomUUID()}`,unit_type:'BIDANG'});assert.equal(field.status,201);const fieldId=(await field.json() as {data:{id:string}}).data.id;
  const division=await call('/api/admin/news/organization/units','POST',news,{name:`Divisi ${randomUUID()}`,unit_type:'DIVISI',parent_id:fieldId});assert.equal(division.status,201);const divisionId=(await division.json() as {data:{id:string}}).data.id;
  assert.equal((await call('/api/admin/news/organization/units','POST',news,{name:'Invalid division',unit_type:'DIVISI'})).status,400);
  const currentOrg=await call('/api/public/organization');const currentData=(await currentOrg.json() as {data:{members:Array<{id:string;is_chairman:boolean}>}}).data;let chairId=currentData.members.find(member=>member.is_chairman)?.id??'';let createdChair=false;if(!chairId){const chair=await call('/api/admin/news/organization/members','POST',news,{name:'Chair Person',is_chairman:true,sort_order:-100});assert.equal(chair.status,201);chairId=(await chair.json() as {data:{id:string}}).data.id;createdChair=true;}
  const one=await call('/api/admin/news/organization/members','POST',news,{name:'Member A',position:'Role',sort_order:-10});const two=await call('/api/admin/news/organization/members','POST',news,{name:'Member B',position:'Role',sort_order:-20});assert.equal(one.status,201);assert.equal(two.status,201);
  const memberId=(await one.json() as {data:{id:string}}).data.id;
  assert.equal((await call(`/api/admin/news/organization/members/${memberId}`,'PUT',news,{name:'Edited Member',is_chairman:false,organization_unit_id:divisionId,sort_order:-5,is_active:true})).status,200);
  const response=await call('/api/public/organization');const result=await response.json() as {data:{organization:{name:string;address:string;phone:string;email:string};members:Array<{id:string;name:string;is_chairman:boolean;organization_unit_id:string|null}>;units:Array<{id:string;unit_type:string;parent_id:string|null}>}};assert.equal(result.data.organization.name,'Test organization');assert.equal(result.data.organization.address,'Jl. Contoh 1');assert.equal(result.data.organization.phone,'+62812345');assert.equal(result.data.organization.email,'info@example.test');assert.equal(result.data.members.find(member=>member.id===memberId)?.name,'Edited Member');assert.equal(result.data.members.find(member=>member.id===memberId)?.organization_unit_id,divisionId);assert.ok(result.data.members.some(member=>member.is_chairman));assert.ok(result.data.units.some(unit=>unit.id===fieldId&&unit.unit_type==='BIDANG'));assert.ok(result.data.units.some(unit=>unit.id===divisionId&&unit.unit_type==='DIVISI'&&unit.parent_id===fieldId));
  await call(`/api/admin/news/organization/members/${memberId}`,'DELETE',news);if(createdChair)await call(`/api/admin/news/organization/members/${chairId}`,'DELETE',news);await call(`/api/admin/news/organization/units/${fieldId}`,'DELETE',news);
 });

 it('isolates Dance and BRT CRUD by role and validates created inventory data',async()=>{
  const dance=await call('/api/admin/rentals/dance/manage/services','POST',manager,{name:'Test dance',description:'Description',price_per_performance:100});assert.equal(dance.status,201);
  const danceId=(await dance.json() as {data:{id:string}}).data.id;assert.equal((await call(`/api/admin/rentals/dance/manage/services/${danceId}`,'PUT',manager,{name:'Edited dance',description:'Updated',price_per_performance:125})).status,200);
  assert.equal((await call('/api/admin/rentals/brt/manage/items','GET',manager)).status,403);
  const category=await call('/api/admin/rentals/brt/manage/categories','POST',brt,{name:'Test category'});assert.equal(category.status,201);const categoryId=(await category.json() as {data:{id:string}}).data.id;const availableCategories=await call('/api/admin/rentals/brt/manage/categories','GET',brt);assert.equal(availableCategories.status,200);assert.ok(((await availableCategories.json() as {data:Array<{id:string}>}).data).some(entry=>entry.id===categoryId));
  const item=await call('/api/admin/rentals/brt/manage/items','POST',brt,{category_id:categoryId,name:'Test item',description:'BRT item',price_per_unit_per_day:12.5,total_quantity:7});assert.equal(item.status,201);
  const itemId=(await item.json() as {data:{id:string}}).data.id;const start=new Date(Date.now()+110*86400000).toISOString().slice(0,10);const held=await createBooking(pool,{customer_name:'Capacity test',customer_phone:'0800000000',domain:'BRT',items:[{item_id:itemId,quantity:3}],start_date:start,end_date:start});
  assert.equal((await call(`/api/admin/rentals/brt/manage/items/${itemId}`,'PUT',brt,{category_id:categoryId,name:'Test item',description:'BRT item',price_per_unit_per_day:12.5,total_quantity:2})).status,409);
  await pool.query('DELETE FROM bookings WHERE booking_code=$1',[held.booking_code]);
  const editedItem=await call(`/api/admin/rentals/brt/manage/items/${itemId}`,'PUT',brt,{category_id:categoryId,name:'Edited test item',description:'Updated BRT item',price_per_unit_per_day:13,total_quantity:6});assert.equal(editedItem.status,200);
  assert.equal((await call('/api/admin/rentals/dance/manage/services','GET',brt)).status,403);
  assert.equal((await call('/api/admin/rentals/brt/manage/items','GET','')).status,401);
  await call(`/api/admin/rentals/brt/manage/items/${itemId}`,'DELETE',brt);await call(`/api/admin/rentals/brt/manage/categories/${categoryId}`,'DELETE',brt);await call(`/api/admin/rentals/dance/manage/services/${danceId}`,'DELETE',manager);
 });

 it('blocks cross-role payment confirmation and enforces media bucket upload permissions',async()=>{
  const stock=await pool.query<{id:string}>('SELECT id FROM inventory_items WHERE is_active AND total_quantity>0 LIMIT 1');
  if(stock.rowCount){const start=new Date(Date.now()+120*86400000).toISOString().slice(0,10);const booking=await createBooking(pool,{customer_name:'Role test',customer_phone:'0800000000',domain:'BRT',items:[{item_id:stock.rows[0]!.id,quantity:1}],start_date:start,end_date:start});assert.equal((await call(`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST',manager,{})).status,403);assert.equal((await call(`/api/admin/bookings/${booking.booking_code}/confirm-payment`,'POST',brt,{})).status,200);await pool.query('DELETE FROM bookings WHERE booking_code=$1',[booking.booking_code]);}
  const upload={bucket:'items',filename:'image.png',mime_type:'image/png',data_base64:'aGVsbG8='};
  assert.equal((await call('/api/admin/media','POST',news,upload)).status,403);
  assert.equal((await call('/api/admin/media','POST',manager,upload)).status,403);
 });

 it('uploads authorized images to local development storage and serves them for previews',async()=>{
  const previousUrl=process.env.SUPABASE_URL,previousKey=process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.SUPABASE_URL;delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  try{
   const upload=await call('/api/admin/media','POST',news,{bucket:'organization',filename:'tiny.png',mime_type:'image/png',data_base64:'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j5Z8AAAAASUVORK5CYII=',alt_text:'Test image'});
   assert.equal(upload.status,201,JSON.stringify(await upload.clone().json()));const media=(await upload.json() as {data:{id:string;url:string}}).data;assert.match(media.url,new RegExp(`/api/public/media/${media.id}/content$`));
   const image=await fetch(media.url);assert.equal(image.status,200);assert.equal(image.headers.get('content-type'),'image/png');assert.ok((await image.arrayBuffer()).byteLength>20);
   await pool.query('DELETE FROM media_assets WHERE id=$1',[media.id]);
  }finally{if(previousUrl===undefined)delete process.env.SUPABASE_URL;else process.env.SUPABASE_URL=previousUrl;if(previousKey===undefined)delete process.env.SUPABASE_SERVICE_ROLE_KEY;else process.env.SUPABASE_SERVICE_ROLE_KEY=previousKey;}
 });
});
