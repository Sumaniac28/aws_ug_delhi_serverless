import { Stack, type StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as route53 from 'aws-cdk-lib/aws-route53';
import type { Construct } from 'constructs';

export interface CertificateStackProps extends StackProps {
  domainName: string;
  hostedZoneId: string;
  hostedZoneName: string;
  /** Add www.<domainName> as an extra name on the certificate. */
  wwwRedirect: boolean;
  /** Other names the same certificate must cover, e.g. the admin app's address. */
  additionalNames?: string[];
}

/**
 * CloudFront only accepts certificates from us-east-1, whatever region everything else lives in,
 * so the certificate gets a stack of its own. DNS validation records are created automatically.
 */
export class CertificateStack extends Stack {
  public readonly certificate: acm.ICertificate;

  constructor(scope: Construct, id: string, props: CertificateStackProps) {
    super(scope, id, { ...props, crossRegionReferences: true });

    const zone = route53.HostedZone.fromHostedZoneAttributes(this, 'Zone', {
      hostedZoneId: props.hostedZoneId,
      zoneName: props.hostedZoneName,
    });

    const otherNames = [...(props.wwwRedirect ? [`www.${props.domainName}`] : []), ...(props.additionalNames ?? [])];
    this.certificate = new acm.Certificate(this, 'SiteCertificate', {
      domainName: props.domainName,
      subjectAlternativeNames: otherNames.length ? otherNames : undefined,
      validation: acm.CertificateValidation.fromDns(zone),
    });
  }
}
