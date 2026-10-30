export type AutoroleDto = {
  enabled: boolean;
  roleId: string | null;
};

export type AutoroleDomain = {
  enabled: number;
  role_id: string | null;
};

export function toDto(domain: AutoroleDomain): AutoroleDto {
  return { enabled: Boolean(domain.enabled), roleId: domain.role_id };
}

export function fromDto(dto: AutoroleDto): AutoroleDomain {
  return { enabled: Number(dto.enabled), role_id: dto.roleId };
}
