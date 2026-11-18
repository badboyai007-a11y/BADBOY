import { describe, expect, it } from 'vitest';
import { getDeveloperModeSkillContext } from './developerModeSkill';

describe('getDeveloperModeSkillContext', () => {
  it('automatically provides implementation, debugging, security and QA workflows', () => {
    const context = getDeveloperModeSkillContext();
    expect(context).toContain('BADBOY DEVELOPER MODE');
    expect(context).toContain('Code implementation');
    expect(context).toContain('Debugging');
    expect(context).toContain('Code review and security');
    expect(context).toContain('Testing and QA');
  });

  it('keeps tool access, owner approval and truthful reporting boundaries', () => {
    const context = getDeveloperModeSkillContext();
    expect(context).toContain('Never claim');
    expect(context).toContain('Do not invent tool capabilities');
    expect(context).toContain('Ask before destructive actions');
  });
});
