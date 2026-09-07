import assert from "node:assert/strict";
import { postgresClient } from "../src/db/client";
import { listLithotripsySessions, requireLithotripsySession } from "../src/lib/accounting/lithotripsy-sessions";
import { normalizeProcedureSet, resolveLithotripsyPricingProfile } from "../src/lib/accounting/lithotripsy-profiles";

const token=Date.now().toString(36);
async function main(){await postgresClient.begin(async tx=>{
  const [user]=await tx.unsafe<Array<{id:string}>>("select u.id from users u join roles r on r.id=u.base_role_id where r.code='owner' and u.archived_at is null limit 1");
  const procedures=await tx.unsafe<Array<{id:string}>>("select id from procedures where archived_at is null and is_active=true order by id limit 2");
  assert.ok(user&&procedures.length>=1);
  const [session]=await tx.unsafe<Array<{id:string;session_number:number}>>(`insert into lithotripsy_sessions(session_number,name,sort_order,created_by_user_id,updated_by_user_id) values((select max(session_number)+1 from lithotripsy_sessions),$1,9999,$2::uuid,$2::uuid) returning id,session_number`,[`TEST-B24A-${token}`,user.id]);
  const discovered=await listLithotripsySessions({},tx);
  assert.ok(discovered.some(item=>item.id===session.id));
  assert.equal((await requireLithotripsySession(session.session_number,tx)).id,session.id);
  const ids=procedures.map(item=>item.id);
  assert.equal(normalizeProcedureSet(ids),normalizeProcedureSet([...ids].reverse()));
  const key=normalizeProcedureSet(ids);
  const [profile]=await tx.unsafe<Array<{id:string}>>(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,session_id,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values($1,$1,$2,$3,$4::uuid,false,true,1,9999,$5::uuid,$5::uuid) returning id`,[`TEST-B24A-LIST-${token}`,key,session.session_number,session.id,user.id]);
  await tx.unsafe("insert into lithotripsy_pricing_profile_procedures(profile_id,procedure_id,sort_order) select $1::uuid,x.id,x.n-1 from unnest($2::uuid[]) with ordinality x(id,n)",[profile.id,ids]);
  await tx.unsafe(`insert into lithotripsy_pricing_profile_lines(profile_id,stable_key,line_type,label,default_amount,effect,source_type,sort_order,active,created_by_user_id,updated_by_user_id) values($1::uuid,'generic_tech','linked_role','الفني — افتراضي',450,'subtract','technicians',0,true,$2::uuid,$2::uuid),($1::uuid,'fixed','fixed_cost','TEST-B24A ثابت',200,'subtract',null,1,true,$2::uuid,$2::uuid)`,[profile.id,user.id]);
  await tx.unsafe("savepoint duplicate_check");
  await assert.rejects(()=>tx.unsafe(`insert into lithotripsy_pricing_profiles(name,normalized_name,procedure_set_key,session_number,session_id,is_base,active,version,sort_order,created_by_user_id,updated_by_user_id) values('dup','dup',$1,$2,$3::uuid,false,true,1,9998,$4::uuid,$4::uuid)`,[key,session.session_number,session.id,user.id]));
  await tx.unsafe("rollback to savepoint duplicate_check");
  const [operation]=await tx.unsafe<Array<{id:string}>>(`insert into operations(type,operation_date,daily_sequence,operation_time,case_name,session_count,lithotripsy_session_id,created_by_user_id,updated_by_user_id) values('lithotripsy',current_date,-9999,'08:00',$1,$2,$3::uuid,$4::uuid,$4::uuid) returning id`,[`TEST-B24A-OP-${token}`,session.session_number,session.id,user.id]);
  for(const id of ids)await tx.unsafe("insert into operation_procedures(operation_id,procedure_id) values($1::uuid,$2::uuid)",[operation.id,id]);
  const resolved=await resolveLithotripsyPricingProfile(operation.id,tx);
  assert.equal(resolved.profile?.id,profile.id);
  assert.equal(resolved.profile?.lines.filter(line=>line.active).length,2);
  await tx.unsafe("update lithotripsy_sessions set active=false,archived_at=now() where id=$1::uuid",[session.id]);
  assert.ok(!(await listLithotripsySessions({},tx)).some(item=>item.id===session.id));
  throw new Error("ROLLBACK_TEST");
}).catch(error=>{if((error as Error).message!=="ROLLBACK_TEST")throw error;});
console.log("lithotripsy pricing hierarchy tests passed");
await postgresClient.end();
}
main().catch(async error=>{console.error(error);await postgresClient.end();process.exit(1)});
