// Role-check middleware lives in auth.ts; re-exported here so routes can import
// `authorize` from the RBAC module name.
export { authorize } from "./auth.js";
