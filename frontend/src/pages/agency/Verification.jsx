import ProviderVerification from '../provider/Verification.jsx';

/**
 * Agency verification.
 *
 * The same screen a provider uses, pointed at the agency endpoints. An agency
 * is verified once and everyone it employs inherits that approval, so there is
 * nothing different to fill in - only who it is about.
 */
export default function AgencyVerification() {
  return <ProviderVerification basePath="/agency-kyc" subject="agency" />;
}
