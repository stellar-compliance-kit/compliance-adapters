import { expectType, expectAssignable, expectError } from 'tsd';
import {
  createLogger,
  Logger,
  LogLevel,
  LogLevelName,
  LoggerOptions,
  LogRecord,
  Transport,
  TransportTargetOptions,
  LoggerFactory,
} from '../src/index';

// createLogger returns a Logger
expectType<Logger>(createLogger());

// createLogger accepts options
expectType<Logger>(createLogger({ level: 'info' }));

// createLogger accepts a string tag
expectType<Logger>(createLogger('my-tag'));

// createLogger accepts tag and options
expectType<Logger>(createLogger('my-tag', { level: 'debug' }));

// createLogger with unknown options should error
expectError(createLogger({ level: 'not-a-level' }));

// Logger methods return void
const logger = createLogger();
expectType<void>(logger.trace('message'));
expectType<void>(logger.debug('message'));
expectType<void>(logger.info('message'));
expectType<void>(logger.warn('message'));
expectType<void>(logger.error('message'));
expectType<void>(logger.fatal('message'));

// Logger methods accept format string and args
expectType<void>(logger.info('message %s', 'arg'));
expectType<void>(logger.info('message %d', 42));
expectType<void>(logger.info({ foo: 'bar' }, 'message'));

// Logger level property
expectType<LogLevel>(logger.level);
expectAssignable<LogLevelName>(logger.level);

// Logger is assignable to LoggerFactory
expectAssignable<LoggerFactory>(createLogger);

// LogLevel enum values
expectAssignable<LogLevel>(LogLevel.Trace);
expectAssignable<LogLevel>(LogLevel.Debug);
expectAssignable<LogLevel>(LogLevel.Info);
expectAssignable<LogLevel>(LogLevel.Warn);
expectAssignable<LogLevel>(LogLevel.Error);
expectAssignable<LogLevel>(LogLevel.Fatal);

// LogLevelName is a string union
expectAssignable<LogLevelName>('trace');
expectAssignable<LogLevelName>('debug');
expectAssignable<LogLevelName>('info');
expectAssignable<LogLevelName>('warn');
expectAssignable<LogLevelName>('error');
expectAssignable<LogLevelName>('fatal');
expectError<LogLevelName>('not-a-level');

// LoggerOptions shape
expectAssignable<LoggerOptions>({});
expectAssignable<LoggerOptions>({ level: 'info' });
expectAssignable<LoggerOptions>({ level: LogLevel.Info });
expectAssignable<LoggerOptions>({ transports: [] });
expectError<LoggerOptions>({ level: 'not-a-level' });

// LogRecord shape
expectAssignable<LogRecord>({
  level: LogLevel.Info,
  levelName: 'info',
  message: 'hello',
});

// Transport is a function type
expectAssignable<Transport>((record: LogRecord) => {
  expectType<LogRecord>(record);
});

// TransportTargetOptions shape
expectAssignable<TransportTargetOptions>({ target: 'stdout' });
expectAssignable<TransportTargetOptions>({ target: 'stdout', level: 'info' });
expectError<TransportTargetOptions>({});