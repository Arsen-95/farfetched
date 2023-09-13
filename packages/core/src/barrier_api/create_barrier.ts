import {
  createEvent,
  createStore,
  is,
  sample,
  split,
  type Effect,
  type Event,
  type Store,
} from 'effector';

import { type RemoteOperation } from '../remote_operation/type';
import { type Barrier } from './type';
import { combineEvents, readonly } from '../libs/patronus';
import { isQuery } from '../query/type';
import { isMutation } from '../mutation/type';
import { get } from '../libs/lohyphen';

type Performer =
  | RemoteOperation<void, any, any, any>
  | Effect<void, any, any>
  | { start: Event<void>; end: Event<any> };

export function createBarrier(config: {
  active: Store<boolean>;
  perform?: Array<Performer>;
}): Barrier;

export function createBarrier(config: {
  activateOn: Event<any>;
  deactivateOn: Event<any>;
}): Barrier;

export function createBarrier(config: {
  activateOn: {
    failure: (options: { params: unknown; error: unknown }) => boolean;
  };
  perform: Array<Performer>;
}): Barrier;

export function createBarrier(config: {
  activateOn: {
    success: (options: { params: unknown; result: unknown }) => boolean;
  };
  perform: Array<Performer>;
}): Barrier;

export function createBarrier({
  active,
  perform,
  activateOn,
  deactivateOn,
}: {
  active?: Store<boolean>;
  activateOn?:
    | Event<any>
    | {
        success?: (options: { params: unknown; result: unknown }) => boolean;
        failure?: (options: { params: unknown; error: unknown }) => boolean;
      };
  deactivateOn?: Event<any>;
  perform?: Array<Performer>;
}): Barrier {
  const activated = createEvent();

  const deactivated = createEvent();
  const touch = createEvent();

  const operationFailed = createEvent<{
    params: unknown;
    error: unknown;
  }>();
  const operationDone = createEvent<{
    params: unknown;
    result: unknown;
  }>();

  const performers = normalizePerformers(perform ?? []);

  let $active: Store<boolean>;
  // Overload: active
  if (active) {
    $active = active;
  }
  // Overload: activateOn/deactivateOn
  else if (is.event(activateOn) && is.event(deactivateOn)) {
    $active = createStore(false, {
      sid: 'barrier.$active',
      name: 'barrier.$active',
    })
      .on(activateOn, () => true)
      .on(deactivateOn, () => false);
  }
  // Overload: activateOn only
  else if (activateOn) {
    $active = createStore(false, {
      sid: 'barrier.$active',
      name: 'barrier.$active',
    });

    if ('failure' in activateOn && activateOn.failure) {
      const callback = activateOn.failure;
      sample({
        clock: operationFailed,
        filter: ({ error, params }) => callback({ error, params }),
        fn: () => true,
        target: [$active, touch],
      });

      sample({
        clock: combineEvents({
          events: performers.map(get('end')),
          reset: operationFailed,
        }),
        fn: () => false,
        target: $active,
      });
    }

    if ('success' in activateOn && activateOn.success) {
      const callback = activateOn.success;
      sample({
        clock: operationDone,
        filter: ({ result, params }) => callback({ result, params }),
        fn: () => true,
        target: [$active, touch],
      });

      sample({
        clock: combineEvents({
          events: performers.map(get('end')),
          reset: operationDone,
        }),
        fn: () => false,
        target: $active,
      });
    }
  } else {
    throw new Error('Invalid configuration of createBarrier');
  }

  split({
    source: $active,
    match: { activated: Boolean },
    cases: { activated, __: deactivated },
  });

  sample({
    clock: touch,
    filter: $active,
    target: performers.map(get('start')),
  });

  return {
    $active: readonly($active),
    activated: readonly(activated),
    deactivated: readonly(deactivated),
    __: { touch, operationFailed, operationDone },
  };
}

function normalizePerformers(
  performers: Performer[]
): Array<{ start: Event<void> | Effect<void, any, any>; end: Event<void> }> {
  return performers.map((performer) => {
    if (perforerIsRemoteOperation(performer)) {
      return {
        start: performer.start,
        end: toVoid(
          sample({
            clock: [performer.finished.success, performer.finished.skip],
          })
        ),
      };
    } else if (performerIsEffect(performer)) {
      return {
        start: performer,
        end: toVoid(performer.done),
      };
    } else {
      return performer;
    }
  });
}

function perforerIsRemoteOperation(
  performer: Performer
): performer is RemoteOperation<void, any, any, any> {
  return isQuery(performer) || isMutation(performer);
}

function performerIsEffect(
  performer: Performer
): performer is Effect<void, any, any> {
  return is.effect(performer);
}

function toVoid(event: Event<any>): Event<void> {
  return sample({
    clock: event,
    fn: () => {
      // pass
    },
  });
}
