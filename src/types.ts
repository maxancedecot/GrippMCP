export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

export type GrippField = {
  name: string;
  type?: string;
  description?: string;
  readonly?: boolean;
  required?: boolean;
  reference?: string;
  relation?: string;
  values?: string[];
};

export type GrippMethod = {
  name: string;
  description?: string;
  params?: JsonValue;
  returns?: string;
  version?: string;
  example?: string;
};

export type GrippClass = {
  name: string;
  description?: string;
  tableName?: string;
  fields: GrippField[];
  methods: GrippMethod[];
};

export type GrippMetadata = {
  source: string;
  generatedAt: string;
  classes: GrippClass[];
};

export type GrippRpcRequest = {
  method: string;
  params: JsonValue[];
  id: number;
};

export type GrippRpcSuccess = {
  id?: number;
  result: JsonValue;
};

export type GrippRpcFailure = {
  id?: number;
  error: JsonValue;
};

export type GrippRpcResponse = GrippRpcSuccess | GrippRpcFailure;

export type GrippBatchItemInput = {
  method: string;
  params?: JsonValue[];
  confirm?: boolean;
};
