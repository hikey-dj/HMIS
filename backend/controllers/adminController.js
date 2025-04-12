import pdf from 'pdfkit';
import fs from 'fs';
import bodyParser from 'body-parser';
import cloudinary from 'cloudinary';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

import Payroll from '../models/payroll.js';
import Employee from '../models/employee.js'; // Import Employee model
import Medicine from '../models/inventory.js'; // Import Medicine model
import { Doctor, Nurse, Pharmacist, Receptionist, Admin, Pathologist, Driver } from '../models/staff.js'; // Import staff models
import FinanceLogs from '../models/logs.js'; // Import FinanceLogs model
import { sendPasswordEmail } from "../config/sendMail.js"; // adjust the path
import nodemailer from 'nodemailer';
import PDFDocument from 'pdfkit';

export const generatePayslip = async (req, res) => {
    try {
        const { employee_id } = req.body;
        const employee = await Employee.findById(employee_id);
        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }
        const { salary: basic_salary, allowance, deduction, net_salary, month_year,email } = employee;
  
      // 1. Generate PDF in memory
      const doc = new PDFDocument();
      let buffers = [];
      
      doc.on('data', buffers.push.bind(buffers));
      doc.on('end', async () => {
        const pdfBuffer = Buffer.concat(buffers);
  
        // 2. Configure Nodemailer transporter
        let transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: process.env.USER,
            pass: process.env.PASS,
          }
        });
  
        // 3. Compose and send email with PDF as attachment
        await transporter.sendMail({
          from: '"Admin Department" hmis.iitg@gmail.com',
          to: email,
          subject: 'Your Monthly Payslip',
          text: 'Please find your payslip attached.',
          attachments: [
            {
              filename: `payslip_${employee_id}.pdf`,
              content: pdfBuffer,
              contentType: 'application/pdf'
            }
          ]
        });
  
        // 4. Respond to client
        res.status(200).json({ message: 'Payslip generated and emailed successfully!' });
      });
  
      // 5. Write PDF content
      doc.fontSize(20).text('Payslip', { align: 'center' });
      doc.moveDown();
      doc.fontSize(12).text(`Employee ID: ${employee_id}`);
      doc.text(`Month/Year: ${new Date(month_year).toLocaleDateString()}`);
      doc.text(`Basic Salary: ${basic_salary}`);
      doc.text(`Allowance: ${allowance}`);
      doc.text(`Deduction: ${deduction}`);
      doc.text(`Net Salary: ${net_salary}`);
      doc.moveDown();
      doc.text('Thank you for your service!', { align: 'center' });
  
      doc.end(); // This triggers the 'end' event
  
    } catch (error) {
      console.error('Error sending payslip email:', error);
      res.status(500).json({ message: 'Failed to generate/send payslip', error });
    }
  };



export const searchEmployees = async (req, res) => { 
    try {
        const { searchKey } = req.query;

        let searchKeyInt = parseInt(searchKey, 10);
        const employees = await Employee.find({
            $or: [
            { name: { $regex: searchKey, $options: 'i' } },
            { _id: !isNaN(searchKeyInt) ? searchKeyInt : undefined }
            ].filter(condition => condition._id !== undefined)
        });

        res.status(200).json({ employees });
    } catch (error) {
        console.error('Error searching employees:', error);
        res.status(500).json({ message: 'Failed to search employees', error });
    }
};



export const updateInventory = async (req, res) => {
    try {
        const { medicineId, med_name, effectiveness, dosage_form, manufacturer, available, batch_no, quantity, expiry_date, manufacturing_date, unit_price, supplier } = req.body;

        // Find the medicine by ID
        let medicine = await Medicine.findById(medicineId);

        if (!medicine) {
            // If medicine does not exist, create a new one
            medicine = new Medicine({
                _id: medicineId,
                med_name,
                effectiveness,
                dosage_form,
                manufacturer,
                available,
                inventory: [{
                    batch_no,
                    quantity,
                    expiry_date,
                    manufacturing_date,
                    unit_price,
                    supplier
                }]
            });

            await medicine.save();
            return res.status(201).json({ message: 'Medicine added and inventory updated successfully', medicine });
        }

        // Check if the batch already exists
        const batchIndex = medicine.inventory.findIndex(batch => batch.batch_no === batch_no);

        if (batchIndex !== -1) {
            // Update the existing batch
            medicine.inventory[batchIndex] = {
                ...medicine.inventory[batchIndex],
                quantity: quantity || medicine.inventory[batchIndex].quantity,
                expiry_date: expiry_date || medicine.inventory[batchIndex].expiry_date,
                manufacturing_date: manufacturing_date || medicine.inventory[batchIndex].manufacturing_date,
                unit_price: unit_price || medicine.inventory[batchIndex].unit_price,
                supplier: supplier || medicine.inventory[batchIndex].supplier
            };
        } else {
            // Add a new batch
            medicine.inventory.push({
                batch_no,
                quantity,
                expiry_date,
                manufacturing_date,
                unit_price,
                supplier
            });
        }

        // Save the updated medicine
        await medicine.save();

        res.status(200).json({ message: 'Inventory updated successfully', medicine });
    } catch (error) {
        console.error('Error updating inventory:', error);
        res.status(500).json({ message: 'Failed to update inventory', error });
    }
};

export const addStaff = async (req, res) => {
    try {
        const { 
            name, email,  role, dept_id, phone_number, emergency_phone, address, 
            date_of_birth, date_of_joining, gender, blood_group, salary, aadhar_id, bank_details, 
            basic_salary, allowance, deduction 
        } = req.body;
        const existingPatient = await Employee.findOne({ $or: [{ email }, { aadhar_number: aadhar_id }] });
        if (existingPatient) {
            return res.status(400).json({ message: 'Email or Aadhar ID already exists.' });
        }

        const imageUrl=req.file?.path;
        // Hash the password
        let PlainPassword=crypto.randomBytes(8).toString('base64').slice(0, 8);
        const hashedPassword = await bcrypt.hash(PlainPassword, 10);

        // Create a new Employee document
        const newEmployee = new Employee({
            name,
            email,
            password: hashedPassword,
            profile_pic: imageUrl,
            role,
            dept_id,
            phone_number,
            emergency_contact:emergency_phone,
            address,
            date_of_birth,
            date_of_joining,
            gender,
            bloodGrp:blood_group,
            salary,
            aadhar_number: aadhar_id,
            bank_details
        });

        // Save the employee to the database
        const savedEmployee = await newEmployee.save();
        await sendPasswordEmail(email,PlainPassword,role);

        // Assign the employee to the appropriate role schema
        switch (role) {
            case 'doctor':
                const { specialization, qualification, experience, room_num } = req.body;
                await Doctor.create({
                    employee_id: savedEmployee._id,
                    department_id: department_id,
                    specialization,
                    qualification,
                    experience,
                    room_num,
                    rating: 0,
                    num_ratings: 0
                });
                break;
            case 'nurse':
                const { assigned_dept, location, assigned_room, assigned_bed, assigned_amb } = req.body;
                await Nurse.create({
                    employee_id: savedEmployee._id,
                    assigned_dept,
                    location,
                    assigned_room,
                    assigned_bed,
                    assigned_amb
                });
                break;
            case 'pharmacist':
                await Pharmacist.create({ employee_id: savedEmployee._id });
                break;
            case 'receptionist':
                await Receptionist.create({ employee_id: savedEmployee._id, assigned_dept: department_id });
                break;
            case 'admin':
                await Admin.create({ employee_id: savedEmployee._id });
                break;
            case 'pathologist':
                const { lab_id } = req.body;
                await Pathologist.create({ employee_id: savedEmployee._id, lab_id });
                break;
            case 'driver':
                await Driver.create({ employee_id: savedEmployee._id });
                break;
            default:
                return res.status(400).json({ message: 'Invalid role specified' });
        }
         // Check if a payroll record already exists for the employee
        //  let payroll = await Payroll.findOne({ employee_id: savedEmployee._id });
        //  if (payroll) {
        //     // Update the existing payroll record
        //     payroll.basic_salary = basic_salary;
        //     payroll.allowance = allowance;
        //     payroll.deduction = deduction;
        //     payroll.net_salary = basic_salary + allowance - deduction;
        //     payroll.month_year = new Date();
        // } else {
          
        //     // Create a new payroll record
        //     payroll = new Payroll({
        //         employee_id: savedEmployee._id,
        //         basic_salary,
        //         allowance,
        //         deduction,
        //         net_salary: basic_salary + allowance - deduction, // Calculate net_salary here
        //         month_year: new Date()
        //     });
           
        // }
        // await payroll.save();
       
        res.status(201).json({ message: 'Staff added successfully', employee: savedEmployee });
    } catch (error) {
        console.error('Error adding staff:', error);
        res.status(500).json({ message: 'Internal server error.' });
    }
};

export const updateSalary = async (req, res) => {
    try {
        const { employee_id, new_salary, basic_salary, allowance, deduction, net_salary } = req.body;

        // Find the employee by ID
        const employee = await Employee.findById(employee_id);

        if (!employee) {
            return res.status(404).json({ message: 'Employee not found' });
        }

        // Update the salary
        employee.salary = new_salary;

        // Save the updated employee
        await employee.save();

        // Find the payroll record for the employee
        const payroll = await Payroll.findOne({ employee_id });

        if (!payroll) {
            return res.status(404).json({ message: 'Payroll record not found for the employee' });
        }

        // Update the payroll details
        payroll.basic_salary = basic_salary;
        payroll.allowance = allowance;
        payroll.deduction = deduction;
        payroll.net_salary = net_salary;

        // Save the updated payroll
        await payroll.save();

        res.status(200).json({ message: 'Salary and payroll updated successfully', employee, payroll });
    } catch (error) {
        console.error('Error updating salary and payroll:', error);
        res.status(500).json({ message: 'Failed to update salary and payroll', error });
    }
};



export const processPayroll = async (req, res) => {
    try {
        const { employee_ids } = req.body;

        if (!Array.isArray(employee_ids) || employee_ids.length === 0) {
            return res.status(400).json({ message: 'Invalid employee IDs provided' });
        }

        for (const employee_id of employee_ids) {
            // Fetch the payroll details for the employee
            const payroll = await Payroll.findOne({ employee_id });

            if (!payroll) {
                console.error(`Payroll not found for employee ID: ${employee_id}`);
                continue;
            }

            if (payroll.net_salary <= 0) {
                console.error(`Net salary is zero or already processed for employee ID: ${employee_id}`);
                continue;
            }

            // Generate a finance log
            const financeLog = new FinanceLogs({
                user_id: employee_id,
                transaction_type: "expense",
                amount: payroll.net_salary,
                description: `Salary payment for ${new Date(payroll.month_year).toLocaleDateString()}`
            });
            await financeLog.save();

            // Generate payslip by calling the generatePayslip function
            await generatePayslip({ body: { employee_id } }, {});

            // Update the payroll record
            payroll.net_salary = 0;
            payroll.payment_status = "paid";
            payroll.generation_date = new Date();
            await payroll.save();
        }

        res.status(200).json({ message: 'Payroll processed successfully' });
    } catch (error) {
        console.error('Error processing payroll:', error);
        res.status(500).json({ message: 'Failed to process payroll', error });
    }
};

