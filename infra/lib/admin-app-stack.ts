import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

export interface AdminAppStackProps extends StackProps {
  /** Admin API base URL (AdminStack output). */
  apiUrl: string;
  /** Hosted Cognito sign-in URL and app client (AdminStack). */
  signInUrl: string;
  userPoolClientId: string;
  /** Public site address: the admin previews uploaded photos from it. */
  siteUrl: string;
  /** Media bucket, so the browser may POST photos to it (the CSP names it exactly). */
  mediaBucketName: string;
  /** Custom domain for the admin, e.g. admin.example.org. Omit to use the default cloudfront.net address. */
  domain?: { domainName: string; hostedZoneId: string; hostedZoneName: string; certificate: acm.ICertificate };
  /** The built admin app (admin/dist). Tests pass inline content. */
  assets: s3deploy.ISource;
}

/**
 * Hosts the admin web app (ADR-002 decision 4): a private S3 bucket behind its own CloudFront
 * distribution, kept out of search engines, with a strict CSP that names exactly the three places the
 * app may talk to (its API, Cognito's sign-in service, and the media bucket for photo uploads).
 *
 * The same build runs in any environment: config.json is written next to index.html at deploy time
 * from this deployment's own outputs, so no address or id is baked into the JavaScript.
 */
export class AdminAppStack extends Stack {
  public readonly bucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  /** Where organizers open the admin. Give this to AdminStack as an admin origin (see the runbook). */
  public readonly adminUrl: string;

  constructor(scope: Construct, id: string, props: AdminAppStackProps) {
    super(scope, id, { ...props, crossRegionReferences: !!props.domain });

    this.bucket = new s3.Bucket(this, 'AppBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const mediaOrigin = `https://${props.mediaBucketName}.s3.${this.region}.amazonaws.com`;
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      `img-src 'self' blob: data: ${props.siteUrl}`,
      "font-src 'self'",
      `connect-src 'self' ${props.apiUrl} ${props.signInUrl} ${mediaOrigin}`,
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      'upgrade-insecure-requests',
    ].join('; ');

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'AdminHeaders', {
      comment: 'Strict CSP, no indexing, no framing',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: csp, override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, preload: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'X-Robots-Tag', value: 'noindex, nofollow, noarchive', override: true },
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()', override: true },
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
        ],
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'AWS UG Delhi NCR admin app',
      domainNames: props.domain ? [props.domain.domainName] : undefined,
      certificate: props.domain?.certificate,
      minimumProtocolVersion: props.domain ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200,
      defaultRootObject: 'index.html',
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
        compress: true,
      },
      // A single-page app: any path the browser asks for directly (e.g. /c/events/new) is served the app shell.
      // A private bucket answers 403 for a missing key, so both codes are mapped.
      errorResponses: [403, 404].map((httpStatus) => ({ httpStatus, responseHttpStatus: 200, responsePagePath: '/index.html', ttl: Duration.seconds(0) })),
    });

    this.adminUrl = props.domain ? `https://${props.domain.domainName}` : `https://${this.distribution.distributionDomainName}`;

    // Upload the build plus config.json (resolved from this deployment's outputs), then clear the CDN cache.
    new s3deploy.BucketDeployment(this, 'DeployApp', {
      destinationBucket: this.bucket,
      sources: [
        props.assets,
        s3deploy.Source.jsonData('config.json', {
          apiUrl: props.apiUrl,
          siteUrl: props.siteUrl,
          cognito: { domain: props.signInUrl, clientId: props.userPoolClientId },
        }),
      ],
      prune: true,
      cacheControl: [s3deploy.CacheControl.fromString('public,max-age=0,must-revalidate')],
      distribution: this.distribution,
      distributionPaths: ['/*'],
    });

    if (props.domain) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', { hostedZoneId: props.domain.hostedZoneId, zoneName: props.domain.hostedZoneName });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
      new route53.ARecord(this, 'AdminA', { zone, recordName: props.domain.domainName, target });
      new route53.AaaaRecord(this, 'AdminAAAA', { zone, recordName: props.domain.domainName, target });
    }

    new CfnOutput(this, 'AdminUrl', { value: this.adminUrl, description: 'Open this to use the admin. Add it as adminOrigins if it is a cloudfront.net address.' });
  }
}
