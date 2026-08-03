export interface WorkbenchCommand {
  readonly id: string;
  readonly label: string;
  readonly run: () => void | Promise<void>;
  readonly enabled?: () => boolean;
}

export interface Disposable { dispose(): void }

export class CommandRegistry {
  readonly #commands = new Map<string, WorkbenchCommand>();

  register(command: WorkbenchCommand): Disposable {
    if (this.#commands.has(command.id)) throw new Error(`Duplicate workbench command: ${command.id}`);
    this.#commands.set(command.id, command);
    return { dispose: () => this.#commands.delete(command.id) };
  }

  async execute(id: string): Promise<void> {
    const command = this.#commands.get(id);
    if (!command) throw new Error(`Unknown workbench command: ${id}`);
    if (command.enabled && !command.enabled()) return;
    await command.run();
  }

  list(): readonly WorkbenchCommand[] { return [...this.#commands.values()]; }
  dispose(): void { this.#commands.clear(); }
}
