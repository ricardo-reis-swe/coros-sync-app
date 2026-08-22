import { concurrency } from '../adapters/db/settings';
import { createAsyncQueue } from './queue';

// The only concurrency knob; passed as a function so N is read per dispatch, never cached.
export const pool = createAsyncQueue(concurrency);
