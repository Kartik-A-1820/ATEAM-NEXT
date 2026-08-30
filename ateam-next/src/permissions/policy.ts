export type Capability =
  | 'read_project'
  | 'write_project'
  | 'write_outside_project'
  | 'shell'
  | 'network'
  | 'destructive_shell'
  | 'package_install'
  | 'git_read'
  | 'git_branch'
  | 'git_commit'
  | 'git_push';

export type PermissionDecision = 'ALLOW' | 'ASK' | 'DENY';
export type PermissionProfile = 'SAFE' | 'STANDARD' | 'FULL';

const profileRules: Record<PermissionProfile, Record<Capability, PermissionDecision>> = {
  SAFE: {
    read_project: 'ALLOW',
    git_read: 'ALLOW',
    write_project: 'ASK',
    shell: 'ASK',
    network: 'ASK',
    package_install: 'ASK',
    git_branch: 'ASK',
    git_commit: 'ASK',
    write_outside_project: 'DENY',
    destructive_shell: 'DENY',
    git_push: 'DENY',
  },
  STANDARD: {
    read_project: 'ALLOW',
    git_read: 'ALLOW',
    write_project: 'ALLOW',
    shell: 'ALLOW',
    git_branch: 'ALLOW',
    package_install: 'ASK',
    network: 'ASK',
    git_commit: 'ASK',
    write_outside_project: 'ASK',
    destructive_shell: 'ASK',
    git_push: 'ASK',
  },
  FULL: {
    read_project: 'ALLOW',
    write_project: 'ALLOW',
    shell: 'ALLOW',
    network: 'ALLOW',
    package_install: 'ALLOW',
    git_read: 'ALLOW',
    git_branch: 'ALLOW',
    git_commit: 'ALLOW',
    write_outside_project: 'ASK',
    destructive_shell: 'ASK',
    git_push: 'ASK',
  },
};

export class PermissionPolicy {
  private denials = new Set<Capability>();

  constructor(readonly profile: PermissionProfile) {}

  deny(capability: Capability): void {
    this.denials.add(capability);
  }

  decide(capability: Capability): PermissionDecision {
    if (this.denials.has(capability)) return 'DENY';
    return profileRules[this.profile][capability];
  }
}
