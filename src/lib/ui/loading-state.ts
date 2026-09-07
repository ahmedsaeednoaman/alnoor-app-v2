export type LoadingState<T> = {
  loading: boolean;
  data: T | null;
  error: string | null;
  requestId: number;
};

export function beginRequest<T>(state: LoadingState<T>, requestId: number): LoadingState<T> {
  return { ...state, loading: true, error: null, requestId };
}

export function settleRequest<T>(state: LoadingState<T>, requestId: number, data: T): LoadingState<T> {
  if (requestId !== state.requestId) return state;
  return { loading: false, data, error: null, requestId };
}

export function failRequest<T>(state: LoadingState<T>, requestId: number, error: string): LoadingState<T> {
  if (requestId !== state.requestId) return state;
  return { loading: false, data: null, error, requestId };
}
