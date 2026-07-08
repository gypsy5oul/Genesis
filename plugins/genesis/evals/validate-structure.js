#!/usr/bin/env node
'use strict';
// Tier-1 structural validation (spec §11.10). Zero dependencies.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const failures = [];
const fail = (msg) => failures.push(msg);

function frontmatter(file) {
  const text = fs.readFileSync(file, 'utf8');
  const m = /^---\n([\s\S]*?)\n---/.exec(text);
  if (!m) return null;
  const fields = {};
  for (const line of m[1].split('\n')) {
    const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line);
    if (kv) fields[kv[1]] = kv[2].trim();
  }
  return fields;
}

// plugin.json parses and has name
try {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  if (p.name !== 'genesis') fail('plugin.json: name must be genesis');
} catch (e) { fail('plugin.json: ' + e.message); }

// agents: frontmatter with name, description, model
const agentsDir = path.join(ROOT, 'agents');
if (fs.existsSync(agentsDir)) {
  for (const f of fs.readdirSync(agentsDir).filter(f => f.endsWith('.md'))) {
    const fm = frontmatter(path.join(agentsDir, f));
    if (!fm) { fail(`agents/${f}: missing frontmatter`); continue; }
    for (const k of ['name', 'description', 'model']) {
      if (!fm[k]) fail(`agents/${f}: missing frontmatter field "${k}"`);
    }
    if (fm.name && fm.name + '.md' !== f) fail(`agents/${f}: name "${fm.name}" != filename`);
  }
}

// skills: each dir (except _shared) has SKILL.md with name + description
const skillsDir = path.join(ROOT, 'skills');
const descriptions = [];
if (fs.existsSync(skillsDir)) {
  for (const d of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!d.isDirectory() || d.name === '_shared') continue;
    const sk = path.join(skillsDir, d.name, 'SKILL.md');
    if (!fs.existsSync(sk)) { fail(`skills/${d.name}: missing SKILL.md`); continue; }
    const fm = frontmatter(sk);
    if (!fm || !fm.name || !fm.description) { fail(`skills/${d.name}: SKILL.md needs name + description`); continue; }
    if (fm.name !== d.name) fail(`skills/${d.name}: name "${fm.name}" != dir name`);
    descriptions.push([d.name, fm.description.toLowerCase()]);
    // referenced _shared files must exist
    const body = fs.readFileSync(sk, 'utf8');
    for (const m of body.matchAll(/_shared\/([\w-]+\.md)/g)) {
      if (!fs.existsSync(path.join(skillsDir, '_shared', m[1]))) {
        fail(`skills/${d.name}: dead reference _shared/${m[1]}`);
      }
    }
  }
}

// Tier-2-lite: identical descriptions collide
for (let i = 0; i < descriptions.length; i++) {
  for (let j = i + 1; j < descriptions.length; j++) {
    if (descriptions[i][1] === descriptions[j][1]) {
      fail(`description collision: skills ${descriptions[i][0]} and ${descriptions[j][0]}`);
    }
  }
}

// workflows: must start with export const meta
const wfDir = path.join(ROOT, 'workflows');
if (fs.existsSync(wfDir)) {
  for (const f of fs.readdirSync(wfDir).filter(f => f.endsWith('.js'))) {
    const head = fs.readFileSync(path.join(wfDir, f), 'utf8').trimStart();
    if (!head.startsWith('export const meta')) fail(`workflows/${f}: must start with export const meta`);
  }
}

// hooks referenced by plugin.json must exist
try {
  const p = JSON.parse(fs.readFileSync(path.join(ROOT, '.claude-plugin', 'plugin.json'), 'utf8'));
  const cmds = JSON.stringify(p.hooks || {});
  for (const m of cmds.matchAll(/\$\{CLAUDE_PLUGIN_ROOT\}\/([\w./-]+\.js)/g)) {
    if (!fs.existsSync(path.join(ROOT, m[1]))) fail(`plugin.json hooks: missing file ${m[1]}`);
  }
} catch { /* already reported */ }

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log('structure OK');
