import { expectType, expectAssignable, expectError } from 'tsd';
import {
  Backoff,
  ExponentialBackoff,
  FibonacciBackoff,
  LinearBackoff,
  PolynomialBackoff,
  ConstantBackoff,
  ExponentialBackoffGenerator,
  FibonacciBackoffGenerator,
  LinearBackoffGenerator,
  PolynomialBackoffGenerator,
  ConstantBackoffGenerator,
} from '../src/index';

// ---------------------------------------------------------------------------
// Backoff (abstract base)
// ---------------------------------------------------------------------------

declare const backoff: Backoff;

expectType<number>(backoff.duration());
expectType<number>(backoff.attempts());
expectType<Backoff>(backoff.reset());
expectType<Backoff>(backoff.next());
expectType<number>(backoff.current());
expectType<boolean>(backoff.done());
expectType<number>(backoff.next());
expectType<number>(backoff.duration());
expectType<number>(backoff.attempts());
expectType<Backoff>(backoff.reset());

// ---------------------------------------------------------------------------
// ExponentialBackoff
// ---------------------------------------------------------------------------

declare const exponential: ExponentialBackoff;

expectType<number>(exponential.duration());
expectType<number>(exponential.attempts());
expectType<ExponentialBackoff>(exponential.reset());
expectType<ExponentialBackoff>(exponential.next());
expectType<number>(exponential.current());
expectType<boolean>(exponential.done());
expectType<number>(exponential.next());
expectType<number>(exponential.duration());
expectType<number>(exponential.attempts());
expectType<ExponentialBackoff>(exponential.reset());

// constructor overloads / options
expectAssignable<ExponentialBackoff>(new ExponentialBackoff());
expectAssignable<ExponentialBackoff>(new ExponentialBackoff({}));
expectAssignable<ExponentialBackoff>(
  new ExponentialBackoff({
    initialDelay: 100,
    maxDelay: 10000,
    multiplier: 2,
    maxNumberOfRetries: 5,
    randomizationFactor: 0.5,
  })
);
expectAssignable<ExponentialBackoff>(new ExponentialBackoff(100));
expectAssignable<ExponentialBackoff>(new ExponentialBackoff(100, 10000));
expectAssignable<ExponentialBackoff>(new ExponentialBackoff(100, 10000, 2));
expectAssignable<ExponentialBackoff>(
  new ExponentialBackoff(100, 10000, 2, 5)
);
expectAssignable<ExponentialBackoff>(
  new ExponentialBackoff(100, 10000, 2, 5, 0.5)
);

// ---------------------------------------------------------------------------
// FibonacciBackoff
// ---------------------------------------------------------------------------

declare const fibonacci: FibonacciBackoff;

expectType<number>(fibonacci.duration());
expectType<number>(fibonacci.attempts());
expectType<FibonacciBackoff>(fibonacci.reset());
expectType<FibonacciBackoff>(fibonacci.next());
expectType<number>(fibonacci.current());
expectType<boolean>(fibonacci.done());
expectType<number>(fibonacci.next());
expectType<number>(fibonacci.duration());
expectType<number>(fibonacci.attempts());
expectType<FibonacciBackoff>(fibonacci.reset());

expectAssignable<FibonacciBackoff>(new FibonacciBackoff());
expectAssignable<FibonacciBackoff>(new FibonacciBackoff({}));
expectAssignable<FibonacciBackoff>(
  new FibonacciBackoff({
    initialDelay: 100,
    maxDelay: 10000,
    maxNumberOfRetries: 5,
    randomizationFactor: 0.5,
  })
);
expectAssignable<FibonacciBackoff>(new FibonacciBackoff(100));
expectAssignable<FibonacciBackoff>(new FibonacciBackoff(100, 10000));
expectAssignable<FibonacciBackoff>(new FibonacciBackoff(100, 10000, 5));
expectAssignable<FibonacciBackoff>(
  new FibonacciBackoff(100, 10000, 5, 0.5)
);

// ---------------------------------------------------------------------------
// LinearBackoff
// ---------------------------------------------------------------------------

declare const linear: LinearBackoff;

expectType<number>(linear.duration());
expectType<number>(linear.attempts());
expectType<LinearBackoff>(linear.reset());
expectType<LinearBackoff>(linear.next());
expectType<number>(linear.current());
expectType<boolean>(linear.done());
expectType<number>(linear.next());
expectType<number>(linear.duration());
expectType<number>(linear.attempts());
expectType<LinearBackoff>(linear.reset());

expectAssignable<LinearBackoff>(new LinearBackoff());
expectAssignable<LinearBackoff>(new LinearBackoff({}));
expectAssignable<LinearBackoff>(
  new LinearBackoff({
    initialDelay: 100,
    maxDelay: 10000,
    maxNumberOfRetries: 5,
    randomizationFactor: 0.5,
  })
);
expectAssignable<LinearBackoff>(new LinearBackoff(100));
expectAssignable<LinearBackoff>(new LinearBackoff(100, 10000));
expectAssignable<LinearBackoff>(new LinearBackoff(100, 10000, 5));
expectAssignable<LinearBackoff>(new LinearBackoff(100, 10000, 5, 0.5));

// ---------------------------------------------------------------------------
// PolynomialBackoff
// ---------------------------------------------------------------------------

declare const polynomial: PolynomialBackoff;

expectType<number>(polynomial.duration());
expectType<number>(polynomial.attempts());
expectType<PolynomialBackoff>(polynomial.reset());
expectType<PolynomialBackoff>(polynomial.next());
expectType<number>(polynomial.current());
expectType<boolean>(polynomial.done());
expectType<number>(polynomial.next());
expectType<number>(polynomial.duration());
expectType<number>(polynomial.attempts());
expectType<PolynomialBackoff>(polynomial.reset());

expectAssignable<PolynomialBackoff>(new PolynomialBackoff());
expectAssignable<PolynomialBackoff>(new PolynomialBackoff({}));
expectAssignable<PolynomialBackoff>(
  new PolynomialBackoff({
    initialDelay: 100,
    maxDelay: 10000,
    maxNumberOfRetries: 5,
    randomizationFactor: 0.5,
  })
);
expectAssignable<PolynomialBackoff>(new PolynomialBackoff(100));
expectAssignable<PolynomialBackoff>(new PolynomialBackoff(100, 10000));
expectAssignable<PolynomialBackoff>(new PolynomialBackoff(100, 10000, 5));
expectAssignable<PolynomialBackoff>(
  new PolynomialBackoff(100, 10000, 5, 0.5)
);

// ---------------------------------------------------------------------------
// ConstantBackoff
// ---------------------------------------------------------------------------

declare const constant: ConstantBackoff;

expectType<number>(constant.duration());
expectType<number>(constant.attempts());
expectType<ConstantBackoff>(constant.reset());
expectType<ConstantBackoff>(constant.next());
expectType<number>(constant.current());
expectType<boolean>(constant.done());
expectType<number>(constant.next());
expectType<number>(constant.duration());
expectType<number>(constant.attempts());
expectType<ConstantBackoff>(constant.reset());

expectAssignable<ConstantBackoff>(new ConstantBackoff());
expectAssignable<ConstantBackoff>(new ConstantBackoff({}));
expectAssignable<ConstantBackoff>(
  new ConstantBackoff({
    initialDelay: 100,
    maxDelay: 10000,
    maxNumberOfRetries: 5,
    randomizationFactor: 0.5,
  })
);
expectAssignable<ConstantBackoff>(new ConstantBackoff(100));
expectAssignable<ConstantBackoff>(new ConstantBackoff(100, 10000));
expectAssignable<ConstantBackoff>(new ConstantBackoff(100, 10000, 5));
expectAssignable<ConstantBackoff>(new ConstantBackoff(100, 10000, 5, 0.5));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

declare const exponentialGenerator: ExponentialBackoffGenerator;
expectType<ExponentialBackoff>(exponentialGenerator.next());
expectType<ExponentialBackoff>(exponentialGenerator.reset());
expectAssignable<ExponentialBackoffGenerator>(
  new ExponentialBackoffGenerator()
);
expectAssignable<ExponentialBackoffGenerator>(
  new ExponentialBackoffGenerator({})
);

declare const fibonacciGenerator: FibonacciBackoffGenerator;
expectType<FibonacciBackoff>(fibonacciGenerator.next());
expectType<FibonacciBackoff>(fibonacciGenerator.reset());
expectAssignable<FibonacciBackoffGenerator>(new FibonacciBackoffGenerator());
expectAssignable<FibonacciBackoffGenerator>(
  new FibonacciBackoffGenerator({})
);

declare const linearGenerator: LinearBackoffGenerator;
expectType<LinearBackoff>(linearGenerator.next());
expectType<LinearBackoff>(linearGenerator.reset());
expectAssignable<LinearBackoffGenerator>(new LinearBackoffGenerator());
expectAssignable<LinearBackoffGenerator>(new LinearBackoffGenerator({}));

declare const polynomialGenerator: PolynomialBackoffGenerator;
expectType<PolynomialBackoff>(polynomialGenerator.next());
expectType<PolynomialBackoff>(polynomialGenerator.reset());
expectAssignable<PolynomialBackoffGenerator>(new PolynomialBackoffGenerator());
expectAssignable<PolynomialBackoffGenerator>(
  new PolynomialBackoffGenerator({})
);

declare const constantGenerator: ConstantBackoffGenerator;
expectType<ConstantBackoff>(constantGenerator.next());
expectType<ConstantBackoff>(constantGenerator.reset());
expectAssignable<ConstantBackoffGenerator>(new ConstantBackoffGenerator());
expectAssignable<ConstantBackoffGenerator>(new ConstantBackoffGenerator({}));

// ---------------------------------------------------------------------------
// Negative cases
// ---------------------------------------------------------------------------

expectError(new ExponentialBackoff('invalid'));
expectError(new FibonacciBackoff('invalid'));
expectError(new LinearBackoff('invalid'));
expectError(new PolynomialBackoff('invalid'));
expectError(new ConstantBackoff('invalid'));

expectError(new ExponentialBackoff({ initialDelay: 'invalid' }));
expectError(new FibonacciBackoff({ maxDelay: 'invalid' }));
expectError(new LinearBackoff({ maxNumberOfRetries: 'invalid' }));
expectError(new PolynomialBackoff({ multiplier: 'invalid' }));
expectError(new ConstantBackoff({ randomizationFactor: 'invalid' }));