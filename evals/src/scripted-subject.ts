import type { Subject, SubjectIdentity, SubjectOutput } from "./runner.js";

/**
 * A subject with no model behind it.
 *
 * ## Why this exists, and why it is not a convenience
 *
 * Every evaluation project the counterevidence scan looked at has one of these
 * under a different name: SWE-bench's `--gold` patch, Terminal-Bench's
 * `--agent oracle`, Inspect Evals' `mockllm` end-to-end test, METR's task
 * self-tests. They exist for one reason, and the scan states it as the doctrine
 * the whole scan converged on:
 *
 *   "Every case came from a step separate from the run."
 *
 * No project found its own broken measurement by looking at its score. The only
 * way to know the harness works is to drive it with an input whose correct
 * output is already known, and check that the harness produces it.
 *
 * This is the sharper half of the same lesson the 6V-0 run learned the hard
 * way: nine manifest records, all nine schema-invalid, every test green.
 *
 * So `ScriptedSubject` is not test scaffolding. It is the oracle path, it is
 * wired to the same runner the live subject uses, and `evals/test/oracle.test.ts`
 * asserts that all four arms produce the metrics they are supposed to produce
 * when the answers are known in advance.
 *
 * `counterfactual: true` is set deliberately and is not cosmetic. The manifest
 * schema defines that flag as "driven from a recorded replay rather than a live
 * call", and requires that such a run not be read as history. A scripted
 * subject is exactly that, and a run of it must never be quoted as evidence
 * about a model.
 */
export class ScriptedSubject implements Subject {
  readonly #answers: readonly string[];
  readonly #identity: SubjectIdentity;
  #calls = 0;

  constructor(
    answers: readonly string[],
    identity: Partial<SubjectIdentity> = {},
  ) {
    this.#answers = answers;
    this.#identity = {
      provider: "scripted",
      model: "scripted-subject",
      adapterId: "eval:scripted",
      scaffold: "oracle",
      counterfactual: true,
      ...identity,
    };
  }

  identity(): SubjectIdentity {
    return this.#identity;
  }

  /** How many times a prompt was asked. Used to assert the runner's call shape. */
  get calls(): number {
    return this.#calls;
  }

  async generate(prompt: string): Promise<SubjectOutput> {
    const answer = this.#answers[this.#calls];
    this.#calls += 1;
    if (answer === undefined) {
      throw new Error(
        `ScriptedSubject was asked for answer #${this.#calls} but only ` +
          `${this.#answers.length} were supplied. The scenario has more episodes ` +
          `than the oracle has answers, which is a fault in the test, not in the ` +
          `runtime — and it must be loud rather than silently returning "". ` +
          `The prompt it could not answer began: ${JSON.stringify(prompt.slice(0, 60))}`,
      );
    }
    return {
      text: answer,
      // A scripted subject has no real usage. `null` rather than `0`, because a
      // zero token count would be summed into a total and read as a measurement.
      inputTokens: null,
      outputTokens: null,
    };
  }
}

/**
 * Fails every call. The negative control for the harness itself.
 *
 * A harness that only ever sees a cooperative subject has not shown it can
 * record a failure. This one exists so `oracle.test.ts` can assert that a
 * subject which throws produces an episode record with an error, a task
 * success rate that reflects it, and a manifest that still conforms.
 */
export class FailingSubject implements Subject {
  identity(): SubjectIdentity {
    return {
      provider: "scripted",
      model: "failing-subject",
      adapterId: "eval:scripted-failing",
      scaffold: "negative-control",
      counterfactual: true,
    };
  }

  async generate(): Promise<SubjectOutput> {
    throw new Error("negative control: this subject always fails");
  }
}
