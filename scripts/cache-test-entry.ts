// Bundle real production hooks and SWR; the runtime replaces only React's host
// lifecycle and browser boundaries, not SWR, fetchers, cache or mutations.
export { SWRConfig, useSWRConfig } from "swr";
export { useSharedReference } from "../src/lib/shared-references";
export { SmartSelect } from "../src/components/operations/smart-select";
export { OperationForm } from "../src/components/operations/operation-form";
export { usePublishedTemplate } from "../src/lib/work-forms/published-template-cache";
