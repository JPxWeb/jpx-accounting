create table if not exists ledger.tag_definitions (
  id text not null,
  organization_id text not null,
  workspace_id text not null,
  name text not null,
  color text,
  primary key (organization_id, workspace_id, id),
  unique (organization_id, workspace_id, name),
  check (length(trim(id)) > 0),
  check (length(trim(name)) > 0)
);

insert into ledger.tag_definitions (id, organization_id, workspace_id, name)
values ('tag_travel', 'org_jpx', 'workspace_main', 'Travel')
on conflict do nothing;
