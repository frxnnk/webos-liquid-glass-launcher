'use strict';
const READ_ACTIONS=Object.freeze(['status','identities','screenStatus','rootStatus']);
const FEATURE_ACTIONS=Object.freeze(['identities','screenStatus','screenPrepare','screenStart','screenStop','rootStatus','rootPlan','rootApply']);
const MUTATING_ACTIONS=Object.freeze(['apply','restore','screenPrepare','screenStart','screenStop','rootApply']);
const ACTIONS=Object.freeze(['status','plan','apply','restore',...FEATURE_ACTIONS]);
module.exports={ACTIONS,READ_ACTIONS,FEATURE_ACTIONS,MUTATING_ACTIONS};
