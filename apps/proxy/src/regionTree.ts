/** Region hierarchy lookups over a child → parent map (Siren region IDs). */
export class RegionTree {
  #parent: ReadonlyMap<number, number>;
  #children: Map<number, number[]>;

  constructor(parent: ReadonlyMap<number, number>) {
    this.#parent = parent;
    this.#children = RegionTree.#buildChildren(parent);
  }

  static #buildChildren(parent: ReadonlyMap<number, number>): Map<number, number[]> {
    const children = new Map<number, number[]>();
    for (const [child, p] of parent) {
      const list = children.get(p);
      if (list) list.push(child);
      else children.set(p, [child]);
    }
    return children;
  }

  get size(): number {
    return this.#parent.size;
  }

  /** Replaces the hierarchy (e.g. after a refresh from upstream). */
  replace(parent: ReadonlyMap<number, number>): void {
    this.#parent = parent;
    this.#children = RegionTree.#buildChildren(parent);
  }

  parentOf(id: number): number | undefined {
    return this.#parent.get(id);
  }

  /** Top-level ancestor of `id` (the id itself if it has no parent). */
  topOf(id: number): number {
    let current = id;
    for (let p = this.#parent.get(current); p !== undefined; p = this.#parent.get(current)) {
      current = p;
    }
    return current;
  }

  childrenOf(id: number): readonly number[] {
    return this.#children.get(id) ?? [];
  }
}
