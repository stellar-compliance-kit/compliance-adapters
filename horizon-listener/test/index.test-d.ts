import { expectType, expectAssignable, expectError } from 'tsd';
import {
  HorizonListener,
  createHorizonListener,
  HorizonEvent,
  HorizonListenerOptions,
  HorizonEventHandler,
  HorizonEventType,
} from '../src/index';

// --- HorizonListener class ---

declare const listener: HorizonListener;

expectType<HorizonListener>(listener);
expectAssignable<HorizonListener>(listener);

// start / stop return promises
expectType<Promise<void>>(listener.start());
expectType<Promise<void>>(listener.stop());

// on() returns the listener instance for chaining
expectType<HorizonListener>(listener.on('message', () => {}));
expectType<HorizonListener>(listener.on('error', () => {}));

// off() returns the listener instance for chaining
expectType<HorizonListener>(listener.off('message', () => {}));

// emit returns a boolean
expectType<boolean>(listener.emit('message', {} as HorizonEvent));

// --- createHorizonListener factory ---

expectType<HorizonListener>(createHorizonListener());
expectType<HorizonListener>(
  createHorizonListener({} as HorizonListenerOptions)
);

// --- HorizonListenerOptions ---

declare const options: HorizonListenerOptions;
expectAssignable<HorizonListenerOptions>(options);

// --- HorizonEvent ---

declare const event: HorizonEvent;
expectAssignable<HorizonEvent>(event);

// --- HorizonEventHandler generic inference ---

declare const handler: HorizonEventHandler<HorizonEvent>;
expectType<(event: HorizonEvent) => void | Promise<void>>(handler);

// --- HorizonEventType ---

expectAssignable<HorizonEventType>('message');
expectAssignable<HorizonEventType>('error');

// --- Negative type checks ---

// start() must not be typed as returning the listener
expectError<HorizonListener>(listener.start());

// on() must not return void
expectError<void>(listener.on('message', () => {}));

// emit() must not return void
expectError<void>(listener.emit('message', {} as HorizonEvent));

// factory must not return a promise
expectError<Promise<HorizonListener>>(createHorizonListener());