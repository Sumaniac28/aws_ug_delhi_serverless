import { Annotations, CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as targets from 'aws-cdk-lib/aws-route53-targets';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';
import { buildCsp } from './csp.ts';
import { renderViewerRequest } from './viewer-request.ts';

export interface SiteStackProps extends StackProps {
  /** Name of the media bucket (Media stack). Imported by name so the two stacks stay independent. */
  mediaBucketName: string;
  /** Inline-script hashes for the CSP, from csp-hashes.json. */
  scriptHashes: string[];
  /** Custom domain settings. All three together, or none for the default cloudfront.net address. */
  domain?: {
    domainName: string;
    hostedZoneId: string;
    hostedZoneName: string;
    wwwRedirect: boolean;
    certificate: acm.ICertificate;
  };
  /** Old path -> new path, for the previous site's routes (Phase 7). */
  redirects?: Record<string, string>;
}

/**
 * The public site (ADR-002 decision 2): a private S3 bucket behind CloudFront with Origin Access
 * Control, a function that maps directory URLs to index.html and enforces one canonical URL per
 * page, strict security headers, and /media/* served from the media bucket.
 */
export class SiteStack extends Stack {
  public readonly siteBucket: s3.Bucket;
  public readonly distribution: cloudfront.Distribution;
  /** Public address of the site (custom domain if set, otherwise the cloudfront.net name). */
  public readonly siteUrl: string;

  constructor(scope: Construct, id: string, props: SiteStackProps) {
    super(scope, id, { ...props, crossRegionReferences: !!props.domain });

    this.siteBucket = new s3.Bucket(this, 'SiteBucket', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      // The site is rebuilt from content, but never delete a live bucket by accident.
      removalPolicy: RemovalPolicy.RETAIN,
    });
    const mediaBucket = s3.Bucket.fromBucketName(this, 'MediaBucket', props.mediaBucketName);
    // The imported bucket cannot take a policy from here by design: the Media stack already grants CloudFront
    // read access to media/* itself, which is what keeps the two stacks free of a dependency cycle.
    Annotations.of(this).acknowledgeWarning('@aws-cdk/aws-cloudfront-origins:updateImportedBucketPolicyOac', 'media/* read access is granted in MediaStack');

    const viewerRequest = new cloudfront.Function(this, 'ViewerRequest', {
      comment: 'Directory index rewrite, trailing-slash and canonical-host redirects',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(renderViewerRequest({ canonicalHost: props.domain?.domainName, redirects: props.redirects })),
    });

    const securityHeaders = new cloudfront.ResponseHeadersPolicy(this, 'SecurityHeaders', {
      comment: 'Strict CSP (hashed inline script only), HSTS and friends',
      securityHeadersBehavior: {
        contentSecurityPolicy: { contentSecurityPolicy: buildCsp(props.scriptHashes), override: true },
        contentTypeOptions: { override: true },
        frameOptions: { frameOption: cloudfront.HeadersFrameOption.DENY, override: true },
        referrerPolicy: { referrerPolicy: cloudfront.HeadersReferrerPolicy.STRICT_ORIGIN_WHEN_CROSS_ORIGIN, override: true },
        strictTransportSecurity: { accessControlMaxAge: Duration.days(730), includeSubdomains: true, preload: false, override: true },
      },
      customHeadersBehavior: {
        customHeaders: [
          { header: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=(), interest-cohort=()', override: true },
          { header: 'Cross-Origin-Opener-Policy', value: 'same-origin', override: true },
        ],
      },
    });

    const names = props.domain ? [props.domain.domainName, ...(props.domain.wwwRedirect ? [`www.${props.domain.domainName}`] : [])] : undefined;

    this.distribution = new cloudfront.Distribution(this, 'Distribution', {
      comment: 'AWS UG Delhi NCR website',
      domainNames: names,
      certificate: props.domain?.certificate,
      // Only a custom certificate can enforce this; the default *.cloudfront.net certificate is fixed at TLSv1.
      minimumProtocolVersion: props.domain ? cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021 : undefined,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      priceClass: cloudfront.PriceClass.PRICE_CLASS_200, // includes India
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.siteBucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: securityHeaders,
        compress: true,
        functionAssociations: [{ function: viewerRequest, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
      additionalBehaviors: {
        // Processed photos. The Media stack's bucket policy lets CloudFront read media/* only.
        '/media/*': {
          origin: origins.S3BucketOrigin.withOriginAccessControl(mediaBucket),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          responseHeadersPolicy: securityHeaders,
          compress: true,
        },
      },
      // A private bucket answers 403 (not 404) for a missing key, so map both to the real 404 page.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 404,
        responsePagePath: '/404.html',
        ttl: Duration.minutes(1),
      })),
    });

    if (props.domain) {
      const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
        hostedZoneId: props.domain.hostedZoneId,
        zoneName: props.domain.hostedZoneName,
      });
      const target = route53.RecordTarget.fromAlias(new targets.CloudFrontTarget(this.distribution));
      for (const [label, recordName] of names!.map((n, i) => [i === 0 ? 'Apex' : 'Www', n] as const)) {
        new route53.ARecord(this, `${label}A`, { zone, recordName, target });
        new route53.AaaaRecord(this, `${label}AAAA`, { zone, recordName, target });
      }
    }

    this.siteUrl = props.domain ? `https://${props.domain.domainName}` : `https://${this.distribution.distributionDomainName}`;

    new CfnOutput(this, 'SiteBucketName', { value: this.siteBucket.bucketName, description: 'Upload dist/ here (aws s3 sync dist/ s3://<name> --delete)' });
    new CfnOutput(this, 'DistributionId', { value: this.distribution.distributionId, description: 'Invalidate /* after each publish' });
    new CfnOutput(this, 'SiteUrl', { value: this.siteUrl });
  }
}
