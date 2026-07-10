import { B, Callout, LegalLayout, LI, Mail, P, Section, SubProcessorTable, UL } from "./legal/LegalLayout";

/**
 * gVoice Privacy Policy.
 *
 * Controller: Groovy Technoweb Private Limited (India). Written against the
 * Digital Personal Data Protection Act, 2023 (India) and the IT Act / SPDI
 * Rules, with dedicated GDPR (EEA/UK) and CCPA/CPRA (California) sections,
 * because gVoice processes meeting recordings, audio, transcripts and
 * AI-generated reports across Azure (incl. Azure OpenAI / Whisper), Sarvam AI,
 * Google, Microsoft and Zoom.
 *
 * NOTE: Items in [SQUARE BRACKETS] are placeholders for the company to confirm
 * before publishing (grievance officer name, plan-specific retention, etc.).
 * Have qualified legal counsel review before relying on this document.
 */
export function PrivacyPolicyPage() {
  return (
    <LegalLayout
      title="Privacy Policy"
      updated="June 24, 2026"
      intro={
        <P>
          This Privacy Policy explains how <B>Groovy Technoweb Private Limited</B> (“gVoice”, “we”, “us”
          or “our”) collects, uses, shares and protects personal data when you use the gVoice
          meeting-intelligence platform, websites and related services (the “Service”). gVoice is a
          product of Groovy Technoweb Private Limited, registered at 517–520, CenterSquare, Santram
          Road, Nadiad – 387001, Gujarat, India. By using the Service you agree to this Policy.
        </P>
      }
    >
      <Section n="1" title="Who we are (Data Controller)">
        <P>
          For the purposes of applicable data-protection law, the controller of your personal data is:
        </P>
        <UL>
          <LI><B>Groovy Technoweb Private Limited</B></LI>
          <LI>517–520, CenterSquare, Santram Road, Nadiad – 387001, Gujarat, India</LI>
          <LI>Email: <Mail address="hello@groovyweb.co" /> · Phone: +91 903 357 8483</LI>
        </UL>
        <P>
          Where gVoice processes meeting content on behalf of a business customer that has its own
          relationship with the meeting participants, gVoice may act as a <B>data processor</B> for that
          content and the customer is the controller. In that case the customer’s own privacy notice
          governs, and we process the content under our agreement with them.
        </P>
      </Section>

      <Section n="2" title="Information we collect">
        <P>We collect the following categories of personal data:</P>
        <UL>
          <LI>
            <B>Account data</B> — your name, email address and a securely hashed password (we never store
            passwords in plain text). If you sign in with a third-party identity provider, we receive
            your basic profile and email from that provider.
          </LI>
          <LI>
            <B>Calendar &amp; connection data</B> — when you connect Google or Microsoft, we store
            access/refresh tokens (encrypted) and the calendar event details needed to schedule and
            auto-join meetings (titles, times, join links, organiser and invitee information).
          </LI>
          <LI>
            <B>Meeting content</B> — when you (or your settings) send the gVoice bot to a meeting, we
            capture and store the meeting <B>audio recording</B>, <B>captions</B>, a <B>diarized
            transcript</B> (who-said-what), the <B>list of participants</B> and their join/leave
            activity, and the <B>AI-generated outputs</B> we create from it (summaries, chapters, action
            items, decisions and sentiment — the “meeting report”).
          </LI>
          <LI>
            <B>Usage &amp; technical data</B> — log data such as IP address, device/browser type, pages
            viewed, feature usage, timestamps and diagnostic information, used to operate and secure the
            Service.
          </LI>
          <LI>
            <B>Cookies &amp; similar technologies</B> — see <B>Cookies</B> below.
          </LI>
        </UL>
        <P>
          Meeting audio and transcripts may include the voices and statements of people who are not
          gVoice account holders. Voice and speech can constitute sensitive personal data in some
          jurisdictions. We rely on the account holder who invites the bot to ensure a lawful basis and
          any required consent exists (see <B>Meeting recording &amp; consent</B>).
        </P>
      </Section>

      <Section n="3" title="How we use your data and our legal bases">
        <P>We use personal data to:</P>
        <UL>
          <LI>provide the Service — join meetings, record, transcribe, diarize and generate reports;</LI>
          <LI>authenticate you, maintain your account and provide support;</LI>
          <LI>schedule and auto-join meetings from your connected calendars;</LI>
          <LI>secure, monitor, debug and improve the Service;</LI>
          <LI>send service and transactional communications; and</LI>
          <LI>comply with legal obligations and enforce our Terms.</LI>
        </UL>
        <P>
          Under the GDPR our legal bases are: <B>performance of a contract</B> (providing the Service you
          requested), <B>legitimate interests</B> (securing and improving the Service), <B>consent</B>
          (where required, e.g. certain cookies or recording where we obtain it directly), and
          <B> legal obligation</B>. Under India’s Digital Personal Data Protection Act, 2023, we process
          personal data on the basis of your <B>consent</B> or other <B>legitimate uses</B> permitted by
          the Act. You may withdraw consent at any time (see <B>Your rights</B>).
        </P>
      </Section>

      <Section n="4" title="Meeting recording & consent">
        <Callout>
          <B>Recording laws vary by country and region.</B> Some jurisdictions require the consent of
          every participant before a meeting may be recorded. You are responsible for understanding and
          complying with the laws that apply to your meetings.
        </Callout>
        <P>
          The gVoice bot joins meetings as a <B>clearly named, visible participant</B> so attendees can
          see that the meeting is being recorded. However, the gVoice account holder who sends the bot
          is responsible for obtaining all consents and providing all notices required by law before the
          recording begins. By using the recording features you confirm that you have the authority and
          all necessary consents to record and process the meeting and the participants’ contributions.
        </P>
        <P>
          If you are a meeting participant and do not consent to being recorded, please tell the meeting
          host, who can remove the bot or stop the recording. To exercise your rights over a recording,
          contact us using the details below; we will route your request to the relevant account holder
          where we act as a processor.
        </P>
      </Section>

      <Section n="5" title="AI processing and sub-processors">
        <P>
          To deliver the Service we share the minimum necessary data with trusted infrastructure and AI
          providers that process it on our instructions and under contractual confidentiality and
          security obligations. We do <B>not</B> sell your personal data, and we do not permit our
          providers to use your meeting content to train their own general-purpose models except as
          required to provide the feature you requested.
        </P>
        <SubProcessorTable
          rows={[
            { name: "Microsoft Azure", purpose: "Cloud hosting, database and encrypted storage of recordings and transcripts", location: "India / EU" },
            { name: "Azure OpenAI Service", purpose: "Generating meeting summaries, chapters, action items and sentiment", location: "EU / US" },
            { name: "Azure AI Speech (Whisper)", purpose: "Speech-to-text transcription", location: "EU / US" },
            { name: "Sarvam AI", purpose: "Speech-to-text transcription for Indian languages", location: "India" },
            { name: "Google LLC", purpose: "Google Meet join + Calendar integration (when you connect it)", location: "US / Global" },
            { name: "Microsoft 365 / Teams", purpose: "Microsoft Teams join + Calendar integration (when you connect it)", location: "US / Global" },
            { name: "Zoom", purpose: "Zoom meeting join (when you use it)", location: "US / Global" }
          ]}
        />
        <P>
          A current list of sub-processors is available on request at <Mail address="hello@groovyweb.co" />.
          We carry out due diligence on each provider and put appropriate safeguards in place for any
          cross-border transfers.
        </P>
      </Section>

      <Section n="6" title="How we share data">
        <P>We share personal data only:</P>
        <UL>
          <LI>with the sub-processors listed above, to operate the Service;</LI>
          <LI>
            with other users in your organisation or meeting where the Service is designed to share a
            meeting (for example, when a meeting and its report are shared with everyone who was
            invited);
          </LI>
          <LI>with professional advisers, auditors and service providers under confidentiality;</LI>
          <LI>
            in connection with a merger, acquisition or sale of assets (you will be notified of any
            change in ownership or use of your personal data);
          </LI>
          <LI>
            where required by law, regulation, legal process or a valid government request, or to protect
            the rights, safety and security of gVoice, our users or the public.
          </LI>
        </UL>
        <P><B>We do not sell your personal data and we do not share it for cross-context behavioural advertising.</B></P>
      </Section>

      <Section n="7" title="International data transfers">
        <P>
          gVoice operates from India and uses providers located in India, the European Union and the
          United States. Where personal data is transferred across borders — including out of the EEA/UK
          — we rely on appropriate safeguards such as the European Commission’s Standard Contractual
          Clauses and equivalent measures, together with technical protections like encryption.
        </P>
      </Section>

      <Section n="8" title="Data retention">
        <P>
          We keep personal data only for as long as necessary for the purposes described in this Policy:
        </P>
        <UL>
          <LI>
            <B>Meeting content</B> (recordings, transcripts and reports) is retained until you delete it
            or close your account. When you delete a meeting or your account, we remove the content from
            active systems within <B>30 days</B> and from encrypted backups within <B>90 days</B>.
          </LI>
          <LI><B>Account data</B> is retained for the life of your account and deleted within 30 days of account closure, subject to legal retention requirements.</LI>
          <LI><B>Logs and diagnostic data</B> are retained for a limited period for security and troubleshooting.</LI>
          <LI>We may retain anonymised or aggregated data, which no longer identifies you, for analytics and product improvement.</LI>
        </UL>
        <P>
          [If your plan specifies a different retention window, that window applies. Enterprise
          administrators may configure organisation-level retention.]
        </P>
      </Section>

      <Section n="9" title="How we protect your data">
        <P>
          We use technical and organisational measures appropriate to the risk, including encryption of
          data in transit (TLS) and at rest, encryption of stored third-party tokens, password hashing
          (bcrypt), access controls and least-privilege administration, network isolation and logging.
          No method of transmission or storage is completely secure, but we work to protect your data
          and to notify you and the authorities of any breach as required by law.
        </P>
      </Section>

      <Section n="10" title="Your rights">
        <P>
          Depending on where you live, you may have the right to: access your personal data; correct
          inaccurate data; delete data (“right to erasure”); restrict or object to certain processing;
          data portability; withdraw consent; and the right to nominate (under India’s DPDP Act) or to
          lodge a complaint with a supervisory authority. California residents have rights under the
          CCPA/CPRA, including the right to know, delete and correct, and the right not to be
          discriminated against for exercising those rights — and, because we do not sell or share
          personal data for advertising, there is nothing to opt out of in that respect.
        </P>
        <P>
          To exercise any right, email <Mail address="hello@groovyweb.co" />. We will verify your request
          and respond within the timeframes required by applicable law. You may also manage and delete
          much of your data directly from within your gVoice dashboard.
        </P>
      </Section>

      <Section n="11" title="Cookies">
        <P>
          We use strictly necessary cookies to keep you signed in and secure, and limited functional and
          analytics cookies to operate and improve the Service. You can control non-essential cookies
          through your browser settings. We honour applicable “Do Not Track” and global privacy control
          signals where required.
        </P>
      </Section>

      <Section n="12" title="Children’s privacy">
        <P>
          The Service is intended for business use and is not directed to children. We do not knowingly
          collect personal data from anyone under the age of 18. If you believe a child has provided us
          personal data, contact us and we will delete it.
        </P>
      </Section>

      <Section n="13" title="Grievance / Data Protection Officer">
        <P>
          In accordance with India’s Digital Personal Data Protection Act, 2023 and the Information
          Technology Act, 2000, you may contact our Grievance Officer with any questions or complaints
          about how we handle your personal data:
        </P>
        <UL>
          <LI><B>[Grievance Officer name]</B>, Grievance Officer</LI>
          <LI>Groovy Technoweb Private Limited, 517–520, CenterSquare, Santram Road, Nadiad – 387001, Gujarat, India</LI>
          <LI>Email: <Mail address="hello@groovyweb.co" /></LI>
        </UL>
        <P>EEA/UK users may also contact us at the same address for GDPR matters and may lodge a complaint with their local data-protection authority.</P>
      </Section>

      <Section n="14" title="Changes to this Policy">
        <P>
          We may update this Policy from time to time. We will post the updated version with a new “Last
          updated” date and, where changes are material, provide additional notice. Your continued use of
          the Service after changes take effect constitutes acceptance.
        </P>
      </Section>

      <Section n="15" title="Contact us">
        <P>
          Questions about this Policy or your personal data? Email <Mail address="hello@groovyweb.co" /> or
          write to Groovy Technoweb Private Limited, 517–520, CenterSquare, Santram Road, Nadiad –
          387001, Gujarat, India.
        </P>
      </Section>
    </LegalLayout>
  );
}
