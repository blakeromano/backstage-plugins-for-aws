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

import {
  GetResourcesCommand,
  ResourceGroupsTaggingAPIClient,
} from '@aws-sdk/client-resource-groups-tagging-api';
import { Logger } from 'winston';
import { AwsResourceLocator } from '@aws/aws-core-plugin-for-backstage-common';
import { AwsCredentialIdentityProvider } from '@aws-sdk/types';
import { Config } from '@backstage/config';
import { DefaultAwsCredentialsManager } from '@backstage/integration-aws-node';
import { convertResourceTypeString, parseResourceLocatorTags } from './utils';

export class AwsResourceTaggingApiLocator implements AwsResourceLocator {
  public constructor(
    private readonly logger: Logger,
    private readonly client: ResourceGroupsTaggingAPIClient,
  ) {}

  static async fromConfig(
    config: Config,
    options: {
      logger: Logger;
    },
  ) {
    let region: string | undefined;
    let accountId: string | undefined;

    const conf = config.getOptionalConfig('aws.locator.resourceTaggingApi');

    if (conf) {
      accountId = conf.getOptionalString('accountId');
      region = conf.getOptionalString('region');
    }

    const credsManager = DefaultAwsCredentialsManager.fromConfig(config);

    let credentialProvider: AwsCredentialIdentityProvider;

    if (accountId) {
      credentialProvider = (
        await credsManager.getCredentialProvider({ accountId })
      ).sdkCredentialProvider;
    } else {
      credentialProvider = (await credsManager.getCredentialProvider())
        .sdkCredentialProvider;
    }

    const client = new ResourceGroupsTaggingAPIClient({
      region: region,
      customUserAgent: 'aws-resourcetaggingapi-plugin-for-backstage',
      credentialDefaultProvider: () => credentialProvider,
    });

    return new AwsResourceTaggingApiLocator(options.logger, client);
  }

  async getResourceArns({
    resourceType,
    tagString,
  }: {
    resourceType: string;
    tagString: string;
  }): Promise<string[]> {
    const TagFilters = parseResourceLocatorTags(tagString).map(e => {
      return {
        Key: e.key,
        Values: [e.value],
      };
    });

    const convertedResourceType = convertResourceTypeString(resourceType);

    this.logger.debug(`Retrieving resource ARNs for ${convertedResourceType}`);

    const response = await this.client.send(
      new GetResourcesCommand({
        ResourceTypeFilters: [convertedResourceType],
        TagFilters,
      }),
    );

    return response.ResourceTagMappingList!.map(e => e.ResourceARN!);
  }
}
