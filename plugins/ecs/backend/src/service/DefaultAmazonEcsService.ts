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

import { Logger } from 'winston';
import {
  ECSClient,
  DescribeServicesCommand,
  DescribeClustersCommand,
  ListTasksCommand,
  DescribeTasksCommand,
} from '@aws-sdk/client-ecs';
import { parse } from '@aws-sdk/util-arn-parser';
import { CatalogApi } from '@backstage/catalog-client';
import {
  AwsResourceLocatorFactory,
  AwsResourceLocator,
  getOneOfEntityAnnotations,
} from '@aws/aws-core-plugin-for-backstage-common';
import {
  AWS_ECS_SERVICE_ARN_ANNOTATION,
  AWS_ECS_SERVICE_TAGS_ANNOTATION,
  ClusterResponse,
  ServiceResponse,
  ServicesResponse,
} from '@aws/amazon-ecs-plugin-for-backstage-common';
import { AwsCredentialsManager } from '@backstage/integration-aws-node';
import { CompoundEntityRef } from '@backstage/catalog-model';
import { AmazonECSService } from './types';
import { DefaultAwsCredentialsManager } from '@backstage/integration-aws-node';
import { Config } from '@backstage/config';

export class DefaultAmazonEcsService implements AmazonECSService {
  public constructor(
    private readonly logger: Logger,
    private readonly catalogApi: CatalogApi,
    private readonly resourceLocator: AwsResourceLocator,
    private readonly credsManager: AwsCredentialsManager,
  ) {}

  static async fromConfig(
    config: Config,
    options: {
      catalogApi: CatalogApi;
      logger: Logger;
      resourceLocator?: AwsResourceLocator;
    },
  ) {
    const credsManager = DefaultAwsCredentialsManager.fromConfig(config);

    const resourceLocator =
      options?.resourceLocator ??
      (await AwsResourceLocatorFactory.fromConfig(config, options.logger));

    return new DefaultAmazonEcsService(
      options.logger,
      options.catalogApi,
      resourceLocator,
      credsManager,
    );
  }

  public async getServicesByEntity(
    entityRef: CompoundEntityRef,
  ): Promise<ServicesResponse> {
    this.logger?.debug(`Fetch ECS Services for ${entityRef}`);

    const entity = await this.catalogApi.getEntityByRef(entityRef);

    if (!entity) {
      throw new Error(`Failed to find entity ${JSON.stringify(entityRef)}`);
    }

    const annotation = getOneOfEntityAnnotations(entity, [
      AWS_ECS_SERVICE_ARN_ANNOTATION,
      AWS_ECS_SERVICE_TAGS_ANNOTATION,
    ]);

    if (!annotation) {
      throw new Error('Annotation not found on entity');
    }

    let arns: string[];

    if (annotation.name === AWS_ECS_SERVICE_TAGS_ANNOTATION) {
      arns = await this.resourceLocator.getResourceArns({
        resourceType: 'AWS::ECS::Service',
        tagString: annotation.value,
      });
    } else {
      arns = [annotation.value];
    }

    const serviceArns: { [k: string]: string[] } = {};

    // Group the ARNs by account ID and region so we can batch API calls
    for (const arn of arns) {
      const { region, accountId } = parse(arn);
      const key = `${region}:${accountId}`;

      if (!(key in serviceArns)) {
        serviceArns[key] = [];
      }

      serviceArns[key].push(arn);
    }

    const clusters = await Promise.all(
      Object.keys(serviceArns).map(async key => {
        const services = serviceArns[key];

        const parts = key.split(':');

        return await this.getServices(parts[0], parts[1], services);
      }),
    );

    return {
      clusters: clusters.reduce((memo, it) => memo.concat(it), []),
    };
  }

  public async getServices(
    region: string,
    accountId: string,
    arns: string[],
  ): Promise<ClusterResponse[]> {
    const response: ClusterResponse[] = [];

    const credentialProvider = (
      await this.credsManager.getCredentialProvider({ accountId })
    ).sdkCredentialProvider;

    const client = new ECSClient({
      region: region,
      customUserAgent: 'aws-ecs-plugin-for-backstage',
      credentialDefaultProvider: () => credentialProvider,
    });

    // The cluster must be specified to describe the services so group by cluster for efficient API calls
    const serviceNames = this.groupServiceArnsByCluster(arns);

    for (const cluster of Object.keys(serviceNames)) {
      const services = serviceNames[cluster];
      const serviceResponseObjects: ServiceResponse[] = [];

      // You can only describe 10 services at once so chunk them
      const chunkedServiceNames = Array.from(
        { length: Math.ceil(services.length / 10) },
        (_, i) => services.slice(i * 10, i * 10 + 10),
      );

      for (const chunk of chunkedServiceNames) {
        const describeServicesResp = await client.send(
          new DescribeServicesCommand({
            cluster,
            services: chunk,
          }),
        );

        for (const serviceResp of describeServicesResp.services!) {
          const listTasksResp = await client.send(
            new ListTasksCommand({
              cluster,
              serviceName: serviceResp.serviceName,
            }),
          );

          const describeTasksResp = await client.send(
            new DescribeTasksCommand({
              cluster,
              tasks: listTasksResp.taskArns,
            }),
          );

          serviceResponseObjects.push({
            service: serviceResp,
            tasks: describeTasksResp.tasks!,
          });
        }
      }

      const clusterResp = await client.send(
        new DescribeClustersCommand({
          clusters: [cluster],
        }),
      );

      response.push({
        cluster: clusterResp.clusters![0],
        services: serviceResponseObjects,
      });
    }

    return response;
  }

  private groupServiceArnsByCluster(arns: string[]): { [k: string]: string[] } {
    const serviceNames: { [k: string]: string[] } = {};

    for (const arn of arns) {
      const { resource } = parse(arn);

      const segments = resource.split('/');
      if (segments.length < 3) throw new Error('Malformed ECS Service ARN');

      const cluster = segments[1];
      const serviceName = segments[2];

      if (!(cluster in serviceNames)) {
        serviceNames[cluster] = [];
      }

      serviceNames[cluster].push(serviceName);
    }

    return serviceNames;
  }
}
