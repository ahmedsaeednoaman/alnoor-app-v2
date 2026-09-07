import assert from "node:assert/strict";
import { groupOperationalReview, type OperationalReviewItem } from "../src/components/operations/operations-list";

const item=(id:string,type:OperationalReviewItem["type"],time:string,overrides:Partial<OperationalReviewItem>={}):OperationalReviewItem=>({id,type,status:"recorded",operationDate:"2026-09-10",dailySequence:Number(id.replace(/\D/g,""))||1,operationTime:time,caseName:id,doctorId:null,doctorName:null,hospitalId:null,hospitalName:null,contractEntityId:null,contractEntityName:null,referenceNumber:null,side:null,sessionCount:null,procedures:[],equipment:[],createdByName:"TEST",hasNotes:false,employeeEditWindow:false,...overrides});

const grouped=groupOperationalReview([
 item("A1","lithotripsy","08:00",{doctorId:"a",doctorName:"Doctor A",procedures:["تفتيت","رفع دعامة"]}),
 item("B1","lithotripsy","09:00",{doctorId:"b",doctorName:"Doctor B"}),
 item("A2","lithotripsy","11:00",{doctorId:"a",doctorName:"Doctor A"}),
 item("B2","lithotripsy","13:00",{doctorId:"b",doctorName:"Doctor B"}),
 item("A3","lithotripsy","15:00",{doctorId:"a",doctorName:"Doctor A"}),
 item("E2","endoscopy","15:30",{doctorId:"a",doctorName:"Doctor A",hospitalId:"hy",hospitalName:"Hospital Y",equipment:["منظار مرن"]}),
 item("E1","endoscopy","09:30",{doctorId:"a",doctorName:"Doctor A",hospitalId:"hx",hospitalName:"Hospital X"}),
 item("E3","endoscopy","10:00",{doctorId:"b",doctorName:"Doctor B",hospitalId:"hx",hospitalName:"Hospital X"}),
 item("C1","contract","08:30",{hospitalId:"ha",hospitalName:"Hospital A",contractEntityId:"x",contractEntityName:"Entity X"}),
 item("C2","contract","12:00",{hospitalId:"ha",hospitalName:"Hospital A",contractEntityId:"x",contractEntityName:"Entity X"}),
 item("C3","contract","09:45",{hospitalId:"hb",hospitalName:"Hospital B",contractEntityId:"y",contractEntityName:"Entity Y"}),
 item("C4","contract","14:00",{hospitalId:"ha",hospitalName:"Hospital A",contractEntityId:"z",contractEntityName:"Entity Z"}),
]);

assert.equal(grouped.length,1);
const litho=grouped[0].types.find(group=>group.type==="lithotripsy")!;
assert.deepEqual(litho.groups.map(group=>group.label),["Doctor A","Doctor B"]);
assert.deepEqual(litho.groups[0].operations.map(operation=>operation.id),["A1","A2","A3"]);
assert.deepEqual(litho.groups[1].operations.map(operation=>operation.id),["B1","B2"]);
assert.deepEqual(litho.groups[0].operations[0].procedures,["تفتيت","رفع دعامة"]);

const endoscopy=grouped[0].types.find(group=>group.type==="endoscopy")!;
assert.equal(endoscopy.groups.length,2);
assert.deepEqual(endoscopy.groups[0].operations.map(operation=>operation.hospitalName),["Hospital X","Hospital Y"]);
assert.deepEqual(endoscopy.groups[0].operations[1].equipment,["منظار مرن"]);

const contract=grouped[0].types.find(group=>group.type==="contract")!;
assert.equal(contract.groups.length,2);
assert.deepEqual(contract.groups.map(group=>group.label),["Hospital A","Hospital B"]);
assert.equal(contract.groups[0].secondaryLabel,"Entity X • Entity Z");
assert.deepEqual(contract.groups[0].operations.map(operation=>operation.id),["C1","C2","C4"]);
assert.deepEqual(contract.groups[0].operations.map(operation=>operation.contractEntityName),["Entity X","Entity X","Entity Z"]);

const newest=groupOperationalReview([item("old","lithotripsy","08:00",{operationDate:"2026-09-09"}),item("new","lithotripsy","08:00",{operationDate:"2026-09-11"})]);
assert.deepEqual(newest.map(day=>day.date),["2026-09-11","2026-09-09"]);
console.log("Operations review grouping regression: PASS");
