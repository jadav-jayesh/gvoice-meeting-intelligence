import { B, Callout, LegalLayout, LI, Mail, P, Section, UL } from "./legal/LegalLayout";

/**
 * gVoice Terms & Conditions.
 *
 * Provider: Groovy Technoweb Private Limited (India). Covers acceptable use,
 * the meeting-recording consent allocation (user is responsible for obtaining
 * consent; bot joins as a visible named participant), third-party-platform
 * compliance, AI-output disclaimers, IP, liability and Indian governing law.
 *
 * NOTE: [SQUARE BRACKET] items are placeholders to confirm before publishing
 * (e.g. fees/refunds if you charge, arbitration seat). Have counsel review.
 */
export function TermsPage() {
  return (
    <LegalLayout
      title="Terms & Conditions"
      updated="June 24, 2026"
      intro={
        <P>
          These Terms &amp; Conditions (“Terms”) are a binding agreement between you (and the
          organisation you represent) and <B>Groovy Technoweb Private Limited</B> (“gVoice”, “we”, “us”),
          a company registered in Nadiad, Gujarat, India, governing your use of the gVoice
          meeting-intelligence platform and related services (the “Service”). By creating an account or
          using the Service, you agree to these Terms and to our{" "}
          <a href="/privacy" className="font-medium text-[var(--gv-accent)] hover:underline">Privacy Policy</a>.
          If you do not agree, do not use the Service.
        </P>
      }
    >
      <Section n="1" title="Eligibility and accounts">
        <P>
          You must be at least 18 years old and able to form a binding contract to use the Service. If
          you use the Service on behalf of an organisation, you represent that you are authorised to bind
          that organisation to these Terms. You are responsible for the accuracy of your account
          information, for keeping your credentials confidential, and for all activity under your
          account. Notify us immediately at <Mail address="hello@groovyweb.co" /> of any unauthorised use.
        </P>
      </Section>

      <Section n="2" title="The Service">
        <P>
          gVoice sends an automated participant (“bot”) to your online meetings on Google Meet, Microsoft
          Teams, Zoom and similar platforms to record audio, generate transcripts, and produce
          AI-generated summaries, chapters, action items and other meeting reports. Features may be added,
          changed or removed over time. We may set reasonable usage limits and perform maintenance.
        </P>
      </Section>

      <Section n="3" title="Meeting recording — your responsibilities">
        <Callout>
          <B>You are responsible for the legality of every recording you initiate.</B> Recording-consent
          laws differ by jurisdiction; some require the consent of all participants. You must obtain all
          consents and give all notices required by applicable law before recording.
        </Callout>
        <P>By using the recording features, you represent and warrant that:</P>
        <UL>
          <LI>you have the authority to record the meeting and to send the gVoice bot;</LI>
          <LI>you have obtained all consents and provided all notices required by law from every participant;</LI>
          <LI>your use of recordings and transcripts complies with all applicable laws and any third-party agreements; and</LI>
          <LI>you will not use the Service to record meetings unlawfully or without authority.</LI>
        </UL>
        <P>
          The bot joins as a clearly named, visible participant to help signal that recording is taking
          place, but this does not replace your obligation to obtain consent. You agree to indemnify
          gVoice for claims arising from your failure to obtain required consents or from your unlawful
          use of recordings (see <B>Indemnification</B>).
        </P>
      </Section>

      <Section n="4" title="Acceptable use">
        <P>You agree not to:</P>
        <UL>
          <LI>use the Service for any unlawful, harmful, fraudulent or infringing purpose;</LI>
          <LI>record or process meetings without the authority and consents required by law;</LI>
          <LI>upload or process content you do not have the right to process, or that is unlawful, defamatory or violates others’ privacy or IP;</LI>
          <LI>attempt to reverse-engineer, disrupt, overload, or gain unauthorised access to the Service or its infrastructure;</LI>
          <LI>resell or provide the Service to third parties except as expressly permitted; or</LI>
          <LI>use the Service to build a competing product or to scrape or harvest data.</LI>
        </UL>
      </Section>

      <Section n="5" title="Third-party platforms and accounts">
        <P>
          The Service interoperates with third-party platforms (e.g. Google, Microsoft, Zoom). Your use
          of those platforms is governed by their own terms and policies, and you must comply with them,
          including their rules on bots, recording and acceptable use. We are not responsible for
          third-party platforms, and they may change or restrict integrations at any time.
        </P>
      </Section>

      <Section n="6" title="AI-generated output">
        <P>
          Transcripts, summaries, action items, sentiment and other outputs are generated by automated
          speech-recognition and AI models and <B>may contain errors, omissions or inaccuracies</B>. They
          are provided as assistance only and are not professional, legal, financial or other advice. You
          are responsible for reviewing and verifying outputs before relying on or acting on them. gVoice
          does not warrant the accuracy or completeness of AI-generated output.
        </P>
      </Section>

      <Section n="7" title="Your content and intellectual property">
        <P>
          As between you and gVoice, you retain all rights in the meeting content you submit or that the
          bot captures on your behalf (“Customer Content”). You grant gVoice a worldwide, non-exclusive
          licence to host, process, transmit and display Customer Content solely to provide and improve
          the Service and as described in our Privacy Policy.
        </P>
        <P>
          gVoice and its licensors own all rights in the Service, software, models, designs and the
          gVoice and Groovy Technoweb brands. Except for the limited right to use the Service under these
          Terms, no rights are granted to you. We may use anonymised or aggregated data that does not
          identify you or any individual to operate and improve the Service.
        </P>
      </Section>

      <Section n="8" title="Fees">
        <P>
          [If the Service or any plan is paid, fees, billing cycles, taxes and refund terms will be set
          out in your order or plan and are incorporated into these Terms. Fees are non-refundable except
          as required by law or expressly stated. We may change fees with prior notice.] Free or trial
          features may be modified or discontinued at any time.
        </P>
      </Section>

      <Section n="9" title="Confidentiality">
        <P>
          Each party may receive confidential information of the other. Each party will protect the
          other’s confidential information with reasonable care and use it only to perform under these
          Terms, except where disclosure is required by law.
        </P>
      </Section>

      <Section n="10" title="Disclaimers">
        <P>
          The Service is provided <B>“as is” and “as available”</B> without warranties of any kind,
          whether express, implied or statutory, including merchantability, fitness for a particular
          purpose, non-infringement, accuracy and uninterrupted or error-free operation, to the maximum
          extent permitted by law.
        </P>
      </Section>

      <Section n="11" title="Limitation of liability">
        <P>
          To the maximum extent permitted by law, gVoice and its affiliates, officers and suppliers will
          not be liable for any indirect, incidental, special, consequential, exemplary or punitive
          damages, or for any loss of profits, revenue, data, goodwill or business, arising out of or
          related to the Service. Our total aggregate liability for all claims relating to the Service
          will not exceed the greater of (a) the amounts you paid to gVoice for the Service in the
          <B> twelve (12) months</B> before the event giving rise to the claim, or (b) [INR 10,000 /
          equivalent], except where such limitation is not permitted by law.
        </P>
      </Section>

      <Section n="12" title="Indemnification">
        <P>
          You will defend, indemnify and hold harmless gVoice and its affiliates from and against any
          claims, damages, liabilities, costs and expenses (including reasonable legal fees) arising from
          (a) your Customer Content; (b) your use of the Service; (c) your breach of these Terms or
          applicable law; or (d) your failure to obtain any consent required to record a meeting.
        </P>
      </Section>

      <Section n="13" title="Suspension and termination">
        <P>
          You may stop using the Service and close your account at any time. We may suspend or terminate
          your access if you breach these Terms, create risk or legal exposure, or fail to pay applicable
          fees. On termination, your right to use the Service ends; provisions that by their nature
          should survive (e.g. IP, confidentiality, disclaimers, liability, indemnity, governing law)
          will survive. We handle your data after termination as described in the Privacy Policy.
        </P>
      </Section>

      <Section n="14" title="Governing law and disputes">
        <P>
          These Terms are governed by the laws of India, without regard to conflict-of-laws rules.
          Subject to any applicable arbitration agreement, the courts at <B>Nadiad, Gujarat, India</B>
          {" "}will have exclusive jurisdiction over disputes arising out of or relating to these Terms or
          the Service. [If arbitration is preferred, disputes may instead be referred to arbitration under
          the Arbitration and Conciliation Act, 1996, seated at Gujarat, India.] Nothing limits rights you
          may have as a consumer under mandatory local law.
        </P>
      </Section>

      <Section n="15" title="Changes to these Terms">
        <P>
          We may update these Terms from time to time. We will post the updated version with a new “Last
          updated” date and, where changes are material, provide additional notice. Your continued use of
          the Service after changes take effect constitutes acceptance of the updated Terms.
        </P>
      </Section>

      <Section n="16" title="Contact us">
        <P>
          Questions about these Terms? Email <Mail address="hello@groovyweb.co" /> or write to Groovy
          Technoweb Private Limited, 517–520, CenterSquare, Santram Road, Nadiad – 387001, Gujarat, India.
        </P>
      </Section>
    </LegalLayout>
  );
}
