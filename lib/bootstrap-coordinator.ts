/** Keep space changes exclusive; authentication changes supersede every old request. */
export function createBootstrapCoordinator<T>(
  load: (spaceId?: string) => Promise<T>,
  apply: (value: T) => void,
) {
  let request = 0;
  let exclusive: symbol | null = null;

  async function loadLatest(spaceId?: string): Promise<boolean> {
    const current = ++request;
    const value = await load(spaceId);
    if (current !== request) return false;
    apply(value);
    return true;
  }

  async function loadExclusive(spaceId?: string): Promise<boolean> {
    const owner = Symbol('bootstrap transition');
    exclusive = owner;
    try {
      return await loadLatest(spaceId);
    } finally {
      // An authentication refresh may have superseded this transition.
      if (exclusive === owner) exclusive = null;
    }
  }

  return {
    get switching() { return exclusive !== null; },
    async refresh(spaceId?: string, priority: 'background' | 'auth' = 'background'): Promise<boolean> {
      if (priority === 'auth') return loadExclusive();
      if (exclusive) return false;
      return loadLatest(spaceId);
    },
    async switchSpace(spaceId: string): Promise<boolean> {
      if (exclusive) return false;
      return loadExclusive(spaceId);
    },
  };
}
