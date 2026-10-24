import { Duration, RemovalPolicy, Stack, type StackProps, CfnOutput, Annotations } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import type { Construct } from 'constructs';
import { fileURLToPath } from 'node:url';

export interface MediaStackProps extends StackProps {
  /** Origins allowed to upload to uploads/ from the browser with a presigned POST (admin app, Phase 4/5). Empty means no CORS. */
  adminOrigins?: string[];
  /** Override the resize code (tests). Default is the package built by `npm run build:lambda`. */
  resizeCode?: lambda.Code;
}

const RESIZE_BUILD = fileURLToPath(new URL('../build/resize', import.meta.url));

/**
 * Content and media storage (ADR-002 decisions 3 and 6).
 *
 *  - content bucket: versioned JSON the admin writes and the site build reads. Versioning is the
 *    history and the rollback, so it is never deleted with the stack.
 *  - media bucket: `uploads/` is private and short-lived; `media/` holds the processed WebP files that
 *    CloudFront serves. The resize Lambda turns one into the other and strips GPS and EXIF on the way.
 */
export class MediaStack extends Stack {
  public readonly contentBucket: s3.Bucket;
  public readonly mediaBucket: s3.Bucket;
  public readonly resizeFunction: lambda.Function;

  constructor(scope: Construct, id: string, props: MediaStackProps = {}) {
    super(scope, id, props);

    const common: s3.BucketProps = {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      removalPolicy: RemovalPolicy.RETAIN,
    };

    // ---- Content: versioned JSON ------------------------------------------------------------
    this.contentBucket = new s3.Bucket(this, 'ContentBucket', {
      ...common,
      versioned: true,
      lifecycleRules: [
        { id: 'expire-old-versions', noncurrentVersionExpiration: Duration.days(365), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
    });

    // ---- Media: uploads/ (raw, private) and media/ (processed, public via CloudFront) ---------
    this.mediaBucket = new s3.Bucket(this, 'MediaBucket', {
      ...common,
      lifecycleRules: [
        // Raw uploads can carry GPS and device data. They are processed within seconds, so a day is ample.
        { id: 'expire-raw-uploads', prefix: 'uploads/', expiration: Duration.days(1), abortIncompleteMultipartUploadAfter: Duration.days(1) },
      ],
      cors: props.adminOrigins?.length
        ? [{ allowedMethods: [s3.HttpMethods.POST, s3.HttpMethods.PUT], allowedOrigins: props.adminOrigins, allowedHeaders: ['*'], exposedHeaders: ['ETag'], maxAge: 3000 }]
        : undefined,
    });

    // CloudFront (OAC) may read media/* only. uploads/ stays unreachable from the web.
    // The distribution is matched by wildcard within this account, not by ARN, so this stack does
    // not depend on the Site stack (which would create a cross-stack dependency cycle).
    this.mediaBucket.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'AllowCloudFrontReadMediaOnly',
        principals: [new iam.ServicePrincipal('cloudfront.amazonaws.com')],
        actions: ['s3:GetObject'],
        resources: [this.mediaBucket.arnForObjects('media/*')],
        conditions: { StringLike: { 'AWS:SourceArn': `arn:${this.partition}:cloudfront::${this.account}:distribution/*` } },
      }),
    );

    // ---- Resize Lambda ------------------------------------------------------------------------
    this.resizeFunction = new lambda.Function(this, 'ResizeFunction', {
      description: 'Resizes uploads/ images to WebP variants under media/ and strips EXIF/GPS',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      handler: 'index.handler',
      code: props.resizeCode ?? lambda.Code.fromAsset(RESIZE_BUILD),
      memorySize: 1536,
      timeout: Duration.seconds(60),
      logGroup: new logs.LogGroup(this, 'ResizeLogs', { retention: logs.RetentionDays.TWO_WEEKS, removalPolicy: RemovalPolicy.DESTROY }),
    });
    // Least privilege, spelled out (the grant* helpers add bucket-level List and extra Put actions we do not need):
    // read raw uploads, write processed media, nothing else.
    this.resizeFunction.addToRolePolicy(new iam.PolicyStatement({ sid: 'ReadRawUploads', actions: ['s3:GetObject'], resources: [this.mediaBucket.arnForObjects('uploads/*')] }));
    this.resizeFunction.addToRolePolicy(new iam.PolicyStatement({ sid: 'WriteProcessedMedia', actions: ['s3:PutObject'], resources: [this.mediaBucket.arnForObjects('media/*')] }));

    // Only uploads/ triggers it. The function writes to media/, so it cannot trigger itself.
    this.mediaBucket.addEventNotification(s3.EventType.OBJECT_CREATED, new s3n.LambdaDestination(this.resizeFunction), { prefix: 'uploads/' });

    if (!props.adminOrigins?.length) {
      Annotations.of(this).addInfo('No adminOrigins set: browser uploads to uploads/ (presigned POST) will be blocked by CORS until the admin origin is added (-c adminOrigins=https://admin.example.org).');
    }

    new CfnOutput(this, 'ContentBucketName', { value: this.contentBucket.bucketName });
    new CfnOutput(this, 'MediaBucketName', { value: this.mediaBucket.bucketName });
  }
}
