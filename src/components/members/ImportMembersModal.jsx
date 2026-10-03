import { useState, useRef } from 'react';
import * as XLSX from 'xlsx';
import {
  Upload,
  FileSpreadsheet,
  Download,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Users,
} from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { formatCurrency } from '../../utils/formatters';
import {
  buildImportRows,
  flagExistingDuplicates,
  summarizeImportRows,
  rejectedImportRows,
} from '../../utils/memberImport';
import { memberService } from '../../services/memberService';

const SAMPLE_MEMBERS = [
  {
    'Full Name': 'Kasun Kalhara Perera',
    'NIC Number': '199512345678',
    Phone: '0771234567',
    'WhatsApp Number': '0771234567',
    Email: 'kasun@gmail.com',
    District: 'Colombo',
    Address: 'No. 45, Temple Road, Nugegoda',
    Gender: 'Male',
    'Date of Birth': '1995-05-14',
    'Emergency Contact': '0777654321',
    'Medical Conditions': 'None',
  },
  {
    'Full Name': 'Dilhani Silva',
    'NIC Number': '987654321V',
    Phone: '0719876543',
    'WhatsApp Number': '0719876543',
    Email: 'dilhani@yahoo.com',
    District: 'Gampaha',
    Address: 'Main Street, Negombo',
    Gender: 'Female',
    'Date of Birth': '1998-11-20',
    'Emergency Contact': '0712223334',
    'Medical Conditions': 'Asthma',
  },
];

// Which step of member creation each failure came from, named in the words a
// staff member would use. The stage is what separates "the member was never
// saved" from "the member was saved and the payment failed".
const STAGE_LABELS = {
  'member-code': 'Member code generation',
  'member-insert': 'Saving the member record',
  'plan-lookup': 'Loading the selected plan',
  membership: 'Creating the membership',
  'receipt-number': 'Generating the receipt number',
  payment: 'Recording the payment',
};

/**
 * One row per failed spreadsheet line: which row it was, who it was, which step
 * failed, the Postgres code and the message the database actually returned.
 *
 * Shared by the partial and failed tables because the columns are the same; only
 * the heading and the advice differ, because only the fix differs.
 */
function FailureTable({ rows }) {
  return (
    <div className="max-h-[200px] overflow-y-auto overflow-x-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs border-collapse">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gym-900/95 backdrop-blur-sm border-b border-hairline text-slate-400">
              <th className="p-2.5 w-14">Row</th>
              <th className="p-2.5 min-w-[140px]">Name</th>
              <th className="p-2.5 w-36">Phone</th>
              <th className="p-2.5 w-40">Failed at</th>
              <th className="p-2.5 w-20">Code</th>
              <th className="p-2.5 min-w-[220px]">Database error</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-hairline">
            {rows.map((failure, index) => (
              <tr key={`${failure.row}-${failure.code || 'x'}-${index}`} className="hover:bg-gym-900/40">
                <td className="p-2.5 font-mono text-slate-400 align-top">{failure.row}</td>
                <td className="p-2.5 font-medium text-slate-200 align-top break-words">
                  {failure.name || '—'}
                </td>
                <td className="p-2.5 font-mono text-slate-300 align-top break-all">
                  {failure.phone || '—'}
                </td>
                <td className="p-2.5 text-slate-400 align-top">{STAGE_LABELS[failure.stage] || failure.stage}</td>
                <td className="p-2.5 font-mono text-amber-300 align-top break-all">
                  {failure.code || '—'}
                </td>
                <td className="p-2.5 text-rose-300 align-top break-words whitespace-normal">
                  {failure.message}
                  {failure.detail && (
                    <span className="block text-[10px] text-slate-400 mt-0.5 font-mono break-words">
                      {failure.detail}
                    </span>
                  )}
                  {failure.hint && (
                    <span className="block text-[10px] text-slate-500 mt-0.5 break-words">
                      {failure.hint}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function ImportMembersModal({ isOpen, onClose, plans = [], currency, onImportComplete }) {
  const [file, setFile] = useState(null);
  const [parsedRows, setParsedRows] = useState([]);
  const [selectedPlanId, setSelectedPlanId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);
  const [error, setError] = useState('');
  const [importSummary, setImportSummary] = useState(null);

  const fileInputRef = useRef(null);

  const downloadTemplate = (format = 'xlsx') => {
    const ws = XLSX.utils.json_to_sheet(SAMPLE_MEMBERS);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Members Import');

    if (format === 'csv') {
      XLSX.writeFile(wb, 'Be_Smart_Gym_Member_Import_Template.csv', { bookType: 'csv' });
    } else {
      XLSX.writeFile(wb, 'Be_Smart_Gym_Member_Import_Template.xlsx');
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setFile(selectedFile);
    parseFile(selectedFile);
  };

  const parseFile = async (uploadFile) => {
    setIsParsing(true);
    setError('');
    setImportSummary(null);

    try {
      const buffer = await uploadFile.arrayBuffer();
      // cellDates hands back real Date objects for date-formatted cells instead
      // of raw serial numbers, so a date of birth survives the round trip.
      const workbook = XLSX.read(new Uint8Array(buffer), { type: 'array', cellDates: true });
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      const rawJson = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

      if (rawJson.length === 0) {
        setError('The uploaded spreadsheet contains no data rows.');
        setParsedRows([]);
        return;
      }

      // Field rules first, then repeats inside the file.
      const normalized = buildImportRows(rawJson);

      // Then the numbers already on file. members.phone has no unique
      // constraint, so this check is the only thing stopping a re-imported
      // sheet from creating a second member for every row.
      const existingPhoneKeys = await memberService.getExistingPhoneKeys();
      setParsedRows(flagExistingDuplicates(normalized, existingPhoneKeys));
    } catch (err) {
      setError(
        err?.message ||
          'Failed to read the file. Please ensure it is a valid .xlsx, .xls or .csv file.'
      );
      setParsedRows([]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleStartImport = async () => {
    const validRows = parsedRows.filter((r) => r.isValid);
    if (validRows.length === 0) {
      setError('No valid rows found to import.');
      return;
    }

    setIsImporting(true);
    setImportProgress(0);
    setError('');

    try {
      const summary = await onImportComplete({
        rows: validRows,
        planId: selectedPlanId || null,
        paymentMethod: paymentMethod,
        onProgress: (current, total) => {
          setImportProgress(Math.round((current / total) * 100));
        },
      });

      setImportSummary(summary);
    } catch (err) {
      setError(err?.message || 'Bulk import failed. Please check database connection.');
    } finally {
      setIsImporting(false);
    }
  };

  const resetModal = () => {
    setFile(null);
    setParsedRows([]);
    setSelectedPlanId('');
    setError('');
    setImportSummary(null);
    setImportProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = '';
    onClose();
  };

  // Duplicates are shown as their own count because they need a different fix in
  // the spreadsheet than a bad district does, but they are also part of the
  // invalid total: a duplicate is never inserted.
  const counts = summarizeImportRows(parsedRows);
  const rejected = rejectedImportRows(parsedRows);
  const validCount = counts.valid;
  const invalidCount = counts.invalid;
  const duplicateCount = counts.duplicate;

  // The summary has to report what happened rather than announce success. A sheet
  // where all twenty rows failed used to open on a green tick reading "Complete",
  // which is exactly how twenty identical failures went unnoticed.
  const importResult = importSummary
    ? {
        successCount: importSummary.successCount ?? 0,
        partialCount: importSummary.partialCount ?? 0,
        failedCount: importSummary.errorCount ?? 0,
      }
    : null;
  const importAllClean = Boolean(
    importResult && importResult.failedCount === 0 && importResult.partialCount === 0
  );
  const importAllFailed = Boolean(
    importResult && importResult.successCount === 0 && importResult.partialCount === 0
  );
  const partialRows = importSummary?.partial ?? [];
  const failedRows = importSummary?.failed ?? [];

  // The one thing worth knowing before pressing the button, repeated in the
  // footer so it is never something you have to scroll back up to find.
  const skippedCount = counts.total - counts.valid;

  const footer = (
    <div className="space-y-2.5">
      {!importSummary && parsedRows.length > 0 && (
        <p className="text-[11px] text-slate-400 text-center sm:text-left">
          <span className="font-semibold text-emerald-400">
            {counts.valid} valid member{counts.valid !== 1 ? 's' : ''} ready
          </span>
          {skippedCount > 0 ? (
            <>
              {' '}
              &bull;{' '}
              <span className="text-amber-400">
                {skippedCount} row{skippedCount !== 1 ? 's' : ''} will be skipped
              </span>
            </>
          ) : null}
        </p>
      )}

      {isImporting && (
        <div className="space-y-1.5">
          <div className="flex justify-between text-[11px] text-slate-300">
            <span>Importing members into database...</span>
            <span className="font-mono font-bold text-brand-gold">{importProgress}%</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-gym-800 overflow-hidden">
            <div
              className="h-full bg-brand-gold transition-all duration-300"
              style={{ width: `${importProgress}%` }}
            />
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2.5">
        {!importSummary && (
          <>
            <Button
              variant="secondary"
              onClick={resetModal}
              disabled={isImporting}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              icon={Upload}
              onClick={handleStartImport}
              disabled={parsedRows.length === 0 || validCount === 0 || isImporting}
              className="w-full sm:w-auto"
            >
              {isImporting
                ? 'Importing...'
                : `Import ${validCount} Valid Member${validCount !== 1 ? 's' : ''}`}
            </Button>
          </>
        )}

        {importSummary && (
          <Button variant="primary" onClick={resetModal} className="w-full">
            Done &amp; View Members
          </Button>
        )}
      </div>
    </div>
  );

  return (
    <Modal
      isOpen={isOpen}
      onClose={resetModal}
      title="Import Members from Excel / Google Sheets"
      className="w-[min(1100px,94vw)] max-w-none"
      footer={footer}
    >
      <div className="space-y-5">
        {/* Step 1 Header & Downloads */}
        <div className="p-4 rounded-xl bg-gym-850/60 border border-hairline flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h4 className="text-sm font-semibold text-slate-100 flex items-center gap-2">
              <FileSpreadsheet className="w-4 h-4 text-brand-gold" />
              Download Sample Import Template
            </h4>
            <p className="text-xs text-slate-400">
              Export your Google Sheet or Excel file using our standard columns format.
            </p>
            <p className="text-[11px] text-slate-500">
              District must be one of the 25 Sri Lankan districts and Gender must be Male, Female or
              Other. Capitalisation and extra spaces do not matter. Leave either column blank to
              leave it unset, but a value that is not recognised rejects the row instead of being
              guessed.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => downloadTemplate('xlsx')}
            >
              Excel (.xlsx)
            </Button>
            <Button
              variant="secondary"
              size="sm"
              icon={Download}
              onClick={() => downloadTemplate('csv')}
            >
              CSV (.csv)
            </Button>
          </div>
        </div>

        {error && (
          <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/20 text-xs text-rose-400 flex items-start gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 mt-px" />
            <span>{error}</span>
          </div>
        )}

        {/* Upload Drop Zone */}
        {!importSummary && (
          <div className="space-y-4">
            <input
              ref={fileInputRef}
              type="file"
              accept=".xlsx, .xls, .csv"
              onChange={handleFileChange}
              className="hidden"
            />

            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gym-700 hover:border-brand-cyan/60 rounded-xl p-8 text-center cursor-pointer bg-gym-950/50 hover:bg-gym-850/40 transition flex flex-col items-center justify-center space-y-3"
            >
              <div className="p-3 rounded-full bg-gym-800 text-brand-cyan">
                <Upload className="w-6 h-6" />
              </div>
              <div>
                <p className="text-sm font-medium text-slate-200">
                  {file ? file.name : 'Click to select or drop your Excel / CSV file here'}
                </p>
                <p className="text-xs text-slate-500 mt-1">
                  Supports Microsoft Excel (.xlsx, .xls) and Google Sheets CSV exports.
                </p>
              </div>
            </div>

            {/* Optional Plan assignment */}
            {parsedRows.length > 0 && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-gym-850/40 border border-hairline">
                <div>
                  <label className="block text-xs font-medium text-slate-300 mb-1.5">
                    Assign Plan to Imported Members (Optional)
                  </label>
                  <select
                    value={selectedPlanId}
                    onChange={(e) => setSelectedPlanId(e.target.value)}
                    className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                  >
                    <option value="">No Plan (Register Member Only)</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatCurrency(p.price, currency)} / {p.duration_days} days)
                      </option>
                    ))}
                  </select>
                </div>

                {selectedPlanId && (
                  <div>
                    <label className="block text-xs font-medium text-slate-300 mb-1.5">
                      Payment Method
                    </label>
                    <select
                      value={paymentMethod}
                      onChange={(e) => setPaymentMethod(e.target.value)}
                      className="w-full rounded-lg bg-gym-850 text-slate-100 text-xs px-3 py-2.5 focus:outline-none focus:ring-2 focus:ring-brand-gold/40"
                    >
                      <option value="Cash">Cash</option>
                      <option value="Card">Card</option>
                      <option value="Bank_Transfer">Bank Transfer</option>
                      <option value="Online">Online Wallet</option>
                    </select>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Parsed Rows Preview */}
        {isParsing ? (
          <div className="text-center py-8 space-y-2 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin mx-auto text-brand-cyan" />
            <p className="text-xs">Parsing spreadsheet rows...</p>
          </div>
        ) : parsedRows.length > 0 && !importSummary ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="w-4 h-4 text-brand-cyan" />
                <h4 className="text-xs font-semibold text-slate-200 uppercase tracking-wider">
                  Spreadsheet Preview
                </h4>
              </div>
            </div>

            {/* The four counts, always all four, so the numbers can be checked
                against each other before anything is written. */}
            {/* Two columns until there is room for four, so the counts never squeeze
                into unreadable slivers on a laptop or a phone. h-full keeps
                the four cards the same height when one label wraps to two
                lines, which "Duplicate Rows" does at narrow widths. */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
              <div className="h-full rounded-lg border border-hairline bg-gym-850/40 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-slate-400">Total Rows</p>
                <p className="text-lg font-bold font-mono text-slate-100">{counts.total}</p>
              </div>
              <div className="h-full rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-emerald-400/80">
                  Valid Rows
                </p>
                <p className="text-lg font-bold font-mono text-emerald-400">{counts.valid}</p>
              </div>
              <div className="h-full rounded-lg border border-rose-500/20 bg-rose-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-rose-400/80">
                  Invalid Rows
                </p>
                <p className="text-lg font-bold font-mono text-rose-400">{counts.invalid}</p>
              </div>
              <div className="h-full rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-2.5">
                <p className="text-[10px] uppercase tracking-wider text-amber-400/80 leading-tight">
                  Duplicate Rows
                </p>
                <p className="text-lg font-bold font-mono text-amber-400">{counts.duplicate}</p>
              </div>
            </div>

            {duplicateCount > 0 && duplicateCount < invalidCount && (
              <p className="text-[11px] text-slate-400">
                {duplicateCount} of the {invalidCount} invalid rows are duplicate phone numbers.
              </p>
            )}

            {/* The table scrolls sideways inside its own container and stops
                growing the modal: the panel is height-capped by the shell, so a
                wide sheet narrows this box instead of widening the dialog. */}
            <div className="max-h-56 overflow-y-auto overflow-x-hidden rounded-lg border border-hairline bg-gym-950">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-gym-900 border-b border-hairline text-slate-400 sticky top-0">
                      <th className="p-2.5 w-14">Row</th>
                      <th className="p-2.5 w-24">Status</th>
                      <th className="p-2.5 min-w-[160px]">Full Name</th>
                      <th className="p-2.5 w-32">NIC</th>
                      <th className="p-2.5 w-36">Mobile Phone</th>
                      <th className="p-2.5 w-32">District</th>
                      <th className="p-2.5 w-24">Gender</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-hairline">
                    {parsedRows.map((row) => (
                      <tr
                        key={row.excelRow}
                        className={row.isValid ? 'hover:bg-gym-900/50' : 'bg-rose-500/5'}
                      >
                        <td className="p-2.5 font-mono text-slate-500">{row.excelRow}</td>
                        <td className="p-2.5">
                          {row.isValid ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                          ) : (
                            <div
                              className="flex items-center gap-1 text-rose-400 min-w-0"
                              title={row.errors.join(', ')}
                            >
                              <XCircle className="w-4 h-4 shrink-0" />
                              <span className="text-[10px] truncate">{row.errors[0]}</span>
                            </div>
                          )}
                        </td>
                        <td className="p-2.5 font-medium text-slate-100 break-words">
                          {row.full_name || '—'}
                        </td>
                        <td className="p-2.5 text-slate-300 font-mono break-all">
                          {row.nic_number || '—'}
                        </td>
                        <td className="p-2.5 text-slate-300 font-mono break-all">
                          {row.phone || '—'}
                        </td>
                        <td className="p-2.5 text-slate-400">{row.district || '—'}</td>
                        <td className="p-2.5 text-slate-400">{row.gender || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Every rejected row, with the spreadsheet row number and the exact
                reason, so the file can be corrected without guessing. */}
            {rejected.length > 0 && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rose-500/20">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <h5 className="text-xs font-semibold text-rose-300">
                    Rows that will NOT be imported ({rejected.length})
                  </h5>
                </div>
                {/* Capped and internally scrollable. This list can hold one entry
                    per rejected row, and letting it grow is what pushed the
                    Import button off the bottom of the screen. */}
                <div className="max-h-[200px] overflow-y-auto overflow-x-hidden">
                  <table className="w-full min-w-[520px] text-left text-xs border-collapse">
                    <thead className="sticky top-0 z-10">
                      <tr className="bg-gym-900/95 backdrop-blur-sm border-b border-hairline text-slate-400">
                        <th className="p-2.5 w-16">Row</th>
                        <th className="p-2.5 min-w-[140px]">Member Name</th>
                        <th className="p-2.5 min-w-[200px]">Problem</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-hairline">
                      {rejected.map((row) => (
                        <tr key={row.excelRow} className="hover:bg-gym-900/40">
                          <td className="p-2.5 font-mono text-slate-400">{row.excelRow}</td>
                          <td className="p-2.5 font-medium text-slate-200 break-words">
                            {row.name}
                          </td>
                          <td className="p-2.5 text-rose-300 break-words">
                            {row.reasons.join('; ')}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {/* Import Summary Results */}
        {importSummary && (
          <div className="space-y-4 py-2">
            <div className="text-center space-y-3">
              <div
                className={`p-4 rounded-full inline-block border ${
                  importAllClean
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    : importAllFailed
                      ? 'bg-rose-500/10 text-rose-400 border-rose-500/20'
                      : 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                }`}
              >
                {importAllClean ? (
                  <CheckCircle2 className="w-12 h-12" />
                ) : importAllFailed ? (
                  <AlertCircle className="w-12 h-12" />
                ) : (
                  <AlertTriangle className="w-12 h-12" />
                )}
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-100">
                  {importAllClean
                    ? 'Bulk Import Complete!'
                    : importAllFailed
                      ? 'No members were imported'
                      : 'Bulk Import Finished With Problems'}
                </h3>

                <div className="text-xs text-slate-300 mt-2 space-y-1">
                  <p>
                    <span className="font-bold text-emerald-400">
                      {importResult.successCount} created
                    </span>{' '}
                    &middot;{' '}
                    <span className="font-bold text-amber-400">
                      {importResult.partialCount} partially created
                    </span>{' '}
                    &middot;{' '}
                    <span className="font-bold text-rose-400">
                      {importResult.failedCount} failed
                    </span>
                  </p>
                  <p className="text-slate-400">
                    A member counts as created only when the member record, the membership and the
                    payment were all written.
                  </p>
                </div>

                {rejected.length > 0 && (
                  <p className="text-xs text-amber-400 mt-2">
                    {rejected.length} row{rejected.length !== 1 ? 's were' : ' was'} skipped before
                    importing because of the problems listed above.
                  </p>
                )}
              </div>
            </div>

            {/* PARTIAL: the member is on file, so this list is the one that must not
                be re-uploaded. It is kept separate from the failures because the
                fix is completely different. */}
            {partialRows.length > 0 && (
              <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 overflow-hidden text-left">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-amber-500/20">
                  <AlertTriangle className="w-4 h-4 text-amber-400" />
                  <h5 className="text-xs font-semibold text-amber-300">
                    Partially created &mdash; member exists ({partialRows.length})
                  </h5>
                </div>
                <p className="px-3 py-2 text-[11px] text-amber-200/90 border-b border-amber-500/20">
                  These members were written to the members table but a later step failed. Do not
                  re-upload this file; fix the plan or payment and set the membership up from the
                  member profile instead.
                </p>
                <FailureTable rows={partialRows} />
              </div>
            )}

            {/* FAILED: nothing was written, so these rows can simply be corrected
                and retried. The database error is shown exactly as returned. */}
            {failedRows.length > 0 && (
              <div className="rounded-lg border border-rose-500/20 bg-rose-500/5 overflow-hidden text-left">
                <div className="flex items-center gap-2 px-3 py-2.5 border-b border-rose-500/20">
                  <AlertCircle className="w-4 h-4 text-rose-400" />
                  <h5 className="text-xs font-semibold text-rose-300">
                    Failed &mdash; no member created ({failedRows.length})
                  </h5>
                </div>
                <p className="px-3 py-2 text-[11px] text-rose-200/90 border-b border-rose-500/20">
                  The row, the step it failed at and the database error code, exactly as the database
                  returned them. Correct the spreadsheet and import again.
                </p>
                <FailureTable rows={failedRows} />
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
