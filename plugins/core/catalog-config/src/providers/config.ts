/**
 * Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
 * Licensed under the Apache License, Version 2.0 (the "License").
 * You may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *     http://www.apache.org/licenses/LICENSE-2.0
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { Config, readDurationFromConfig } from '@backstage/config';
import {
  AwsInfrastructureConfig,
  AwsInfrastructureConfigOptions,
  FieldsSpecTransformDefinition,
  FieldsTransformDefinition,
  FieldTransformDefinition,
  FilterDefinition,
  TagFilterDefinition,
  TransformDefinition,
} from './types';
import { IncrementalEntityProviderOptions } from '@backstage/plugin-catalog-backend-module-incremental-ingestion';

export function readAwsInfrastructureConfigs(
  config: Config,
): AwsInfrastructureConfig[] {
  const configs: AwsInfrastructureConfig[] = [];

  const providerConfigs = config.getOptionalConfig(
    'catalog.providers.awsConfig',
  );

  if (!providerConfigs) {
    return configs;
  }

  for (const id of providerConfigs.keys()) {
    configs.push(
      readAwsInfrastructureConfig(id, providerConfigs.getConfig(id)),
    );
  }

  return configs;
}

function readAwsInfrastructureConfig(
  id: string,
  config: Config,
): AwsInfrastructureConfig {
  const transform = readTransformDefinitionFromConfig(config);

  const filters = readFiltersFromConfig(config.getConfig('filters'));

  const aggregator = config.getOptionalString('aggregator');
  const accountId = config.getOptionalString('accountId');
  const region = config.getOptionalString('region');

  const options = config.has('options')
    ? readAwsInfrastructureOptionsConfig(config.getConfig('options'))
    : undefined;

  return {
    id,
    accountId,
    region,
    filters,
    transform,
    aggregator,
    options,
  };
}

function readAwsInfrastructureOptionsConfig(
  config: Config,
): AwsInfrastructureConfigOptions {
  const pageSize = config.getOptionalNumber('pageSize');

  const incremental = config.has('incremental')
    ? readAwsInfrastructureIncrementalOptionsConfig(
        config.getConfig('incremental'),
      )
    : undefined;

  return {
    pageSize,
    incremental,
  };
}

function readAwsInfrastructureIncrementalOptionsConfig(
  config: Config,
): Partial<IncrementalEntityProviderOptions> {
  const burstInterval = config.has('burstInterval')
    ? readDurationFromConfig(config, {
        key: 'burstInterval',
      })
    : undefined;
  const burstLength = config.has('burstLength')
    ? readDurationFromConfig(config, { key: 'burstLength' })
    : undefined;
  const restLength = config.has('restLength')
    ? readDurationFromConfig(config, { key: 'restLength' })
    : undefined;

  return {
    burstInterval,
    burstLength,
    restLength,
  };
}

function readFiltersFromConfig(config: Config): FilterDefinition {
  const tagFilters = readTagFiltersFromConfig(config);

  const resourceTypes = config.getStringArray('resourceTypes');

  return {
    resourceTypes,
    tagFilters,
  };
}

function readTagFiltersFromConfig(config: Config): TagFilterDefinition[] {
  if (!config.has('tags')) {
    return [];
  }

  const tagFiltersConfig = config.getConfigArray('tags');

  return tagFiltersConfig.map(c => {
    return {
      key: c.getString('key'),
      value: c.getOptionalString('value'),
    };
  });
}

function readTransformDefinitionFromConfig(
  config: Config,
): TransformDefinition | undefined {
  if (!config.has('transform')) {
    return undefined;
  }

  const transformsConfig = config.getConfig('transform');

  const fields = readFieldsTransformDefinitionFromConfig(transformsConfig);

  return {
    fields,
  };
}

function readFieldsTransformDefinitionFromConfig(
  config: Config,
): FieldsTransformDefinition | undefined {
  if (!config.has('fields')) {
    return undefined;
  }

  const fieldsConfig = config.getConfig('fields');

  const spec = readFieldsSpecTransformDefinitionFromConfig(fieldsConfig);

  const name = readFieldTransformDefinitionFromConfig(fieldsConfig, 'name');

  const annotations = new Map<string, FieldTransformDefinition>();

  if (fieldsConfig.has('annotations')) {
    const annotationsConfig = fieldsConfig.getConfig('annotations');

    annotationsConfig.keys().forEach(key => {
      annotations.set(
        key,
        readFieldTransformDefinitionFromConfig(annotationsConfig, key)!,
      );
    });
  }

  return {
    spec,
    name,
    annotations,
  };
}

function readFieldsSpecTransformDefinitionFromConfig(
  config: Config,
): FieldsSpecTransformDefinition | undefined {
  if (!config.has('spec')) {
    return undefined;
  }

  const specConfig = config.getConfig('spec');

  return {
    owner: readFieldTransformDefinitionFromConfig(specConfig, 'owner'),
    component: readFieldTransformDefinitionFromConfig(specConfig, 'component'),
    system: readFieldTransformDefinitionFromConfig(specConfig, 'system'),
    type: readFieldTransformDefinitionFromConfig(specConfig, 'type'),
  };
}

function readFieldTransformDefinitionFromConfig(
  config: Config,
  name: string,
): FieldTransformDefinition | undefined {
  if (config.has(name)) {
    const fieldConfig = config.getConfig(name);

    return {
      tag: fieldConfig.getOptionalString('tag'),
      value: fieldConfig.getOptionalString('value'),
      expression: fieldConfig.getOptionalString('expression'),
    };
  }

  return undefined;
}
